import dotenv from 'dotenv';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BD } from '../models/BD.js';

dotenv.config();

// Dry run by default. Explicit --apply is required to insert into the LIVE database.
// No fallback database is started and no existing document is updated or deleted.
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function request(apiURL: string, endpoint: string, token?: string, body?: unknown) {
  const url = new URL(endpoint, apiURL);
  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, res => {
      let text = '';
      res.on('data', chunk => text += chunk);
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, data: JSON.parse(text) }); }
        catch { reject(new Error(`Non-JSON response from ${endpoint}`)); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Request timed out: ${endpoint}`)));
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function main() {
  const file = option('--file');
  const mongoURI = option('--mongo-uri') || process.env.MONGODB_URI;
  const apiURL = option('--api-url') || `http://127.0.0.1:${process.env.PORT || 5000}`;
  const apply = args.includes('--apply');
  const reportPath = option('--report');
  if (!file || !mongoURI || (apply && !reportPath)) {
    throw new Error('Usage: node dist/utils/importBDs.js --file <xlsx> [--mongo-uri <live URI>] [--api-url <URL>] [--apply --report <json>]');
  }

  const source = await readFile(file);
  const workbook = XLSX.read(source, { type: 'buffer' });
  const valid: Array<{ sheet: string; row: number; name: string; email: string }> = [];
  const invalid: unknown[] = [];
  const duplicates: unknown[] = [];
  const seen = new Map<string, { sheet: string; row: number }>();
  const nameEmails = new Map<string, string[]>();
  let totalRows = 0, activeRows = 0, inactiveRows = 0, blankRows = 0;
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: '', blankrows: true });
    if (!rows.length || rows.every(row => row.every(cell => !String(cell).trim()))) continue;
    // Header match is case-insensitive: the real workbook uses NAME, not Name.
    const headers = rows[0].map(cell => String(cell).trim().toLowerCase());
    const nameIndex = headers.indexOf('name'), emailIndex = headers.indexOf('email address'), statusIndex = headers.indexOf('status');
    if ([nameIndex, emailIndex, statusIndex].some(index => index < 0)) throw new Error(`Required columns are missing in sheet ${sheet}`);
    for (let index = 1; index < rows.length; index++) {
      const cells = rows[index];
      if (cells.every(cell => !String(cell).trim())) { blankRows++; continue; }
      totalRows++;
      if (String(cells[statusIndex]).trim().toLowerCase() !== 'active') { inactiveRows++; continue; }
      activeRows++;
      const name = String(cells[nameIndex] ?? '').trim();
      const email = normalizeEmail(cells[emailIndex]);
      const record = { sheet, row: index + 1, name, email };
      const validation = new BD({ name, email }).validateSync();
      if (validation) { invalid.push({ ...record, reasons: Object.keys(validation.errors) }); continue; }
      if (seen.has(email)) { duplicates.push({ ...record, firstOccurrence: seen.get(email) }); continue; }
      seen.set(email, { sheet, row: index + 1 });
      const nameKey = name.toLowerCase();
      nameEmails.set(nameKey, [...(nameEmails.get(nameKey) || []), email]);
      valid.push(record);
    }
  }

  const auth = await request(apiURL, '/api/auth/login', undefined, {
    email: process.env.IMPORT_STAFF_EMAIL || 'staff@adinn.com',
    password: process.env.IMPORT_STAFF_PASSWORD || 'Staff@123',
    role: 'STAFF',
  });
  assert.equal(auth.status, 200, 'Existing staff authentication must succeed');
  const token: string = auth.data.token;
  const initialAPI = await request(apiURL, '/api/bds', token);
  assert.equal(initialAPI.status, 200, 'Existing BD API must be available');

  await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000, autoCreate: false, autoIndex: false });
  const db = mongoose.connection.db!;
  const liveUser = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(auth.data.user.id) });
  assert.ok(liveUser && liveUser.email === auth.data.user.email, 'Import database must contain the authenticated live API user');
  const existing = await BD.find().lean();
  assert.deepEqual(existing.map(bd => String(bd._id)).sort(), initialAPI.data.data.map((bd: any) => bd._id).sort(), 'Database BD IDs must match the live API');
  const existingByEmail = new Map(existing.map(bd => [normalizeEmail(bd.email), bd]));
  const skipped = valid.filter(row => existingByEmail.has(row.email));
  const pending = valid.filter(row => !existingByEmail.has(row.email));

  async function snapshotOthers() {
    const names = new Set((await db.listCollections().toArray()).map(collection => collection.name));
    // Include absent business collections so unexpected creation is detected too.
    for (const name of ['clients', 'clientassociations', 'sweetdistributions']) names.add(name);
    names.delete(BD.collection.collectionName);
    const result: Record<string, { count: number; sha256: string }> = {};
    for (const name of [...names].sort()) {
      const documents = await db.collection(name).find().sort({ _id: 1 }).toArray();
      result[name] = { count: documents.length, sha256: digest(JSON.stringify(documents)) };
    }
    return result;
  }

  const before = await snapshotOthers();
  const report: Record<string, any> = {
    sourceFile: path.resolve(file), sourceSHA256: digest(source), generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run', database: db.databaseName, collection: BD.collection.collectionName,
    totalRows, activeRows, inactiveRows, blankRows, validUniqueActiveRows: valid.length,
    invalid, duplicates,
    repeatedNamesWithDistinctEmails: [...nameEmails].filter(([, emails]) => emails.length > 1).map(([name, emails]) => ({ name, emails })),
    existingBDsBefore: existing.length, existingSkipped: skipped.length, pending: pending.length,
    inserted: 0, updated: 0, insertedIDs: [], before,
  };
  async function saveReport() {
    if (reportPath) {
      await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    }
  }
  if (!apply) { console.log(JSON.stringify(report, null, 2)); return; }
  await saveReport();
  try {
    // Existing model enforces the email schema/unique index. Distinct emails with the
    // same name are retained; the manual API's name check would discard these users.
    for (const row of pending) {
      const bd = await BD.create({ name: row.name, email: row.email });
      report.inserted++;
      report.insertedIDs.push(String(bd._id));
    }
    const after = await snapshotOthers();
    report.after = after;
    assert.deepEqual(after, before, 'All non-BD collections must remain unchanged');
    const finalBDs = await BD.find().lean();
    const finalByID = new Map(finalBDs.map(bd => [String(bd._id), bd]));
    for (const bd of existing) assert.deepEqual(finalByID.get(String(bd._id)), bd, 'Existing BDs must remain unchanged');
    const finalByEmail = new Map(finalBDs.map(bd => [normalizeEmail(bd.email), bd]));
    for (const row of valid) assert.ok(finalByEmail.has(row.email), 'Every valid Active workbook email must exist in MongoDB');
    assert.equal(finalBDs.length, existing.length + report.inserted, 'BD count must equal previous count plus inserts');
    const finalAPI = await request(apiURL, '/api/bds', token);
    assert.equal(finalAPI.status, 200);
    const apiByEmail = new Map(finalAPI.data.data.map((bd: any) => [normalizeEmail(bd.email), bd]));
    for (const row of valid) assert.ok(apiByEmail.has(row.email), 'Every workbook BD must be returned by the existing dropdown API');
    report.finalBDCount = finalBDs.length;
    report.verifiedWorkbookEmails = valid.length;
    report.nonBDCollectionsUnchanged = true;
    report.existingBDsUnchanged = true;
    report.success = true;
  } catch (error) {
    report.success = false;
    report.failure = error instanceof assert.AssertionError ? 'Verification assertion failed' : 'Import failed; inspect inserted IDs before retrying';
    throw error;
  } finally {
    await saveReport();
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => {
  // Never print MongoDB URIs, tokens, passwords or document contents on failure.
  console.error('BD import failed:', error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());

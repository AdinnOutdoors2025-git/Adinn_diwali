import dotenv from 'dotenv';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EJSON } from 'bson';
import { BD } from '../models/BD.js';

dotenv.config();
const args = process.argv.slice(2);
const option = (key: string) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
const emailKey = (email: unknown) => String(email ?? '').trim().toLowerCase();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const request = (base: string, endpoint: string, token?: string, body?: unknown) => new Promise<any>((resolve, reject) => {
  const url = new URL(endpoint, base);
  const req = (url.protocol === 'https:' ? https : http).request(url, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }, res => {
    let data = ''; res.on('data', chunk => data += chunk); res.on('error', reject);
    res.on('end', () => {
      try { assert.equal(res.statusCode, 200, `Live API unavailable: ${endpoint}`); resolve(JSON.parse(data)); }
      catch (error) { reject(error); }
    });
  });
  req.setTimeout(15000, () => req.destroy(new Error('Live API timed out')));
  req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
});

async function main() {
  const file = option('--file'), uri = option('--mongo-uri') || process.env.MONGODB_URI;
  const base = option('--api-url') || `http://127.0.0.1:${process.env.PORT || 5000}`;
  const reportFile = option('--report'), apply = args.includes('--apply');
  if (!file || !uri || (apply && !reportFile)) throw new Error('Use --file <xlsx> --mongo-uri <live URI> [--api-url <URL>] [--apply --report <json>]');
  const bytes = await readFile(file), workbook = XLSX.read(bytes, { type: 'buffer' });
  const source = new Map<string, { name: string; email: string; sheet: string; row: number }>();
  const duplicates: unknown[] = [], invalid: unknown[] = [], ambiguous: unknown[] = [];
  let totalRows = 0, blankRows = 0;
  const statuses: Record<string, number> = {};
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: '', blankrows: true });
    if (!rows.length) continue;
    const header = rows[0].map(cell => String(cell).trim().toLowerCase());
    const nameIndex = header.indexOf('name'), emailIndex = header.indexOf('email address'), statusIndex = header.indexOf('status');
    assert.ok(nameIndex >= 0 && emailIndex >= 0, `Missing Name/Email Address columns in ${sheet}`);
    for (let index = 1; index < rows.length; index++) {
      if (rows[index].every(cell => !String(cell).trim())) { blankRows++; continue; }
      totalRows++;
      const name = String(rows[index][nameIndex] ?? ''), email = emailKey(rows[index][emailIndex]);
      const record = { name, email, sheet, row: index + 1 };
      if (statusIndex >= 0) { const status = String(rows[index][statusIndex]).trim(); statuses[status] = (statuses[status] || 0) + 1; }
      const candidate = new BD({ name, email });
      if (candidate.validateSync()) { invalid.push(record); continue; }
      if (candidate.name !== name) { ambiguous.push({ ...record, reason: 'Model normalization would change the exact source name' }); continue; }
      if (source.has(email)) {
        if (source.get(email)!.name === name) duplicates.push(record);
        else ambiguous.push({ ...record, reason: 'One email is assigned to different source names', firstOccurrence: source.get(email) });
        continue;
      }
      source.set(email, record);
    }
  }
  assert.ok(source.size, 'No valid replacement rows');
  const auth = await request(base, '/api/auth/login', undefined, { email: process.env.IMPORT_STAFF_EMAIL || 'staff@adinn.com', password: process.env.IMPORT_STAFF_PASSWORD || 'Staff@123' });
  const live = await request(base, '/api/bds', auth.token);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, autoCreate: false, autoIndex: false });
  const db = mongoose.connection.db!;
  assert.ok(await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(auth.user.id), email: auth.user.email }), 'Database must match the live authenticated API');
  const before = await BD.find().lean();
  assert.deepEqual(before.map(row => String(row._id)).sort(), live.data.map((row: any) => row._id).sort(), 'BD IDs must match the live API');
  assert.equal(new Set(before.map(row => emailKey(row.email))).size, before.length, 'Existing normalized emails must be unique');
  const existing = new Map(before.map(row => [emailKey(row.email), row]));
  const obsolete = before.filter(row => !source.has(emailKey(row.email)));
  const changed = before.filter(row => source.has(emailKey(row.email)) && source.get(emailKey(row.email))!.name !== row.name);
  const additions = [...source.values()].filter(row => !existing.has(row.email));
  const references = new Set<string>();
  for (const collection of ['clientassociations', 'sweetdistributions']) {
    for (const row of await db.collection(collection).find().toArray()) if (row.bd) references.add(String(row.bd));
  }
  // Repurposed mailboxes must never silently rename a historical person. This run has no such references.
  for (const row of [...obsolete, ...changed]) if (references.has(String(row._id))) ambiguous.push({ id: String(row._id), name: row.name, email: row.email, reason: 'Obsolete or changed BD is referenced; explicit historical handling is required' });
  const snapshotOthers = async () => {
    const result: Record<string, { count: number; sha256: string }> = {};
    for (const collection of (await db.listCollections().toArray()).filter(row => row.name !== BD.collection.collectionName).sort((a, b) => a.name.localeCompare(b.name))) {
      const rows = await db.collection(collection.name).find().sort({ _id: 1 }).toArray();
      result[collection.name] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
    }
    return result;
  };
  const untouchedBefore = await snapshotOthers();
  const repeatedNames = new Map<string, string[]>();
  for (const row of source.values()) repeatedNames.set(row.name, [...(repeatedNames.get(row.name) || []), row.email]);
  const report: Record<string, any> = {
    sourceFile: path.resolve(file), sourceSHA256: hash(bytes), sourceSheets: workbook.SheetNames, columns: ['NAME', 'Email Address', 'Status'],
    generatedAt: new Date().toISOString(), mode: apply ? 'replacement' : 'dry-run', totalRows, blankRows, statuses,
    validSourceEntries: source.size, duplicateRecordsHandled: duplicates.length, duplicates, invalid, ambiguous,
    repeatedNamesWithDistinctEmails: [...repeatedNames].filter(([, emails]) => emails.length > 1).map(([name, emails]) => ({ name, emails })),
    previousBDCount: before.length, matchingEmails: before.length - obsolete.length, unchanged: before.length - obsolete.length - changed.length,
    plannedRenames: changed.map(row => ({ id: String(row._id), oldName: row.name, name: source.get(emailKey(row.email))!.name, email: row.email })),
    plannedAdditions: additions.length, plannedRemovals: obsolete.map(row => ({ id: String(row._id), name: row.name, email: row.email })),
    beforeOtherCollections: untouchedBefore,
  };
  const save = async () => {
    if (!reportFile) return;
    await mkdir(path.dirname(path.resolve(reportFile)), { recursive: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  };
  if (!apply) { await save(); console.log(JSON.stringify(report, null, 2)); return; }
  assert.equal(invalid.length, 0, 'Invalid source rows must be reviewed before replacement');
  assert.equal(ambiguous.length, 0, 'Ambiguous source/referenced records must be reviewed before replacement');
  const backup = `${reportFile}.before-bds.ejson`;
  await mkdir(path.dirname(path.resolve(backup)), { recursive: true });
  await writeFile(backup, EJSON.stringify(before));
  report.backupFile = path.resolve(backup);
  await save();
  try {
    if (additions.length) await BD.insertMany(additions.map(row => ({ name: row.name, email: row.email })));
    for (const old of changed) {
      const result = await BD.updateOne({ _id: old._id, name: old.name, email: old.email }, { $set: { name: source.get(emailKey(old.email))!.name } });
      assert.equal(result.modifiedCount, 1, 'Existing BD changed concurrently; stop replacement');
    }
    const obsoleteIDs = obsolete.map(row => row._id);
    for (const collection of ['clientassociations', 'sweetdistributions']) assert.equal(await db.collection(collection).countDocuments({ bd: { $in: [...obsoleteIDs, ...changed.map(row => row._id)] } }), 0, 'References changed during replacement');
    // Never call the old DELETE API: it cascades into client associations.
    const removal = await BD.deleteMany({ _id: { $in: obsoleteIDs } });
    assert.equal(removal.deletedCount, obsolete.length);
    const after = await BD.find().lean();
    const pairs = (rows: { name: string; email: string }[]) => rows.map(row => JSON.stringify([row.name, emailKey(row.email)])).sort();
    assert.deepEqual(pairs(after), pairs([...source.values()]), 'Final master must equal the source exactly, not a union');
    const finalByID = new Map(after.map(row => [String(row._id), row]));
    for (const id of references) {
      const old = before.find(row => String(row._id) === id);
      if (old) { assert.equal(finalByID.get(id)?.name, old.name); assert.equal(finalByID.get(id)?.email, old.email); }
    }
    const untouchedAfter = await snapshotOthers();
    assert.deepEqual(untouchedAfter, untouchedBefore, 'Clients, associations, histories, users and timestamps must remain unchanged');
    const apiAfter = await request(base, '/api/bds', auth.token);
    assert.deepEqual(pairs(apiAfter.data), pairs([...source.values()]));
    report.inserted = additions.length; report.renamed = changed.length; report.removed = removal.deletedCount;
    report.finalBDCount = after.length; report.exactSourceMatch = true; report.historicalIdentitiesPreserved = true;
    report.afterOtherCollections = untouchedAfter; report.success = true;
  } catch (error) { report.success = false; report.failure = 'Replacement or verification failed; consult the backup and planned operations before retrying'; throw error; }
  finally { await save(); console.log(JSON.stringify(report, null, 2)); }
}

main().catch(error => {
  console.error('BD replacement failed:', error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());

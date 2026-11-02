// Imports the "Diwali Boxes Info" workbook (Sheet2) as clients, Type/Requestee associations and Diwali distributions.
//   npx tsx src/utils/importSheetClients.ts --file <xlsx> --db MONGODB_URI|MONGODB_URI_LIVE [--apply]
// Dry run by default. Only inserts; existing clients, associations and distributions are never updated or deleted.
import dotenv from 'dotenv';
dotenv.config();
import dns from 'node:dns';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { describeMongoUri } from '../config/db.js';
import { Client } from '../models/Client.js';
import { ClientAssociation } from '../models/ClientAssociation.js';
import { SweetDistribution } from '../models/SweetDistribution.js';
import { BD } from '../models/BD.js';
import { isClientType, ClientType, DistributionMode } from '../config/distribution.js';
import { LEGACY_OCCASION } from '../config/occasions.js';
import { normalizeMobile, normalizeName } from './normalize.js';

dns.setServers(['8.8.8.8']);

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const YEAR = 2026;
// Unnamed rows that belong to the client named in the row above them (confirmed for Rapport only).
const NAME_OVERRIDES: Record<number, string> = { 173: 'Rapport', 174: 'Rapport' };

interface Row { row: number; name: string; mobile: string; email: string; type: ClientType; bdEmail: string; bdName: string; qty: number; mode: DistributionMode; address: string; }

function readRows(file: string) {
  const sheet = XLSX.readFile(file).Sheets['Sheet2'];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }).slice(1);
  const rows: Row[] = [], skipped: { row: number; name: string; reason: string }[] = [];
  raw.forEach((r, i) => {
    const row = i + 2;
    const name = clean(r[0]) || NAME_OVERRIDES[row] || '';
    const phone = String(r[1]);
    if (!name && !phone.trim() && !clean(r[3])) return;
    if (!name) return void skipped.push({ row, name: '', reason: 'no client name' });
    const mobile = normalizeMobile(phone.split(/[/\n]/)[0]);
    if (!/^\d{10}$/.test(mobile)) return void skipped.push({ row, name, reason: 'missing/invalid phone' });
    let type = clean(r[3]);
    if (/^govt\.? official$/i.test(type)) type = 'Govt. Official';
    const modeText = clean(r[7]).toLowerCase().replace(/\s/g, '');
    const mode = modeText === 'courier' ? 'COURIER' : modeText === 'inperson' ? 'IN_PERSON' : null;
    const qty = Number(r[6]);
    if (!isClientType(type) || !mode || !Number.isInteger(qty) || qty < 1) return void skipped.push({ row, name, reason: `invalid type/mode/quantity (${type}/${clean(r[7])}/${r[6]})` });
    rows.push({ row, name, mobile, email: clean(r[2]).toLowerCase(), type, bdEmail: clean(r[5]).toLowerCase(), bdName: clean(r[4]), qty, mode, address: String(r[8] ?? '').trim().replace(/[ \t]+/g, ' ') });
  });
  return { rows, skipped };
}

async function main() {
  const file = option('--file'), dbVar = option('--db'), apply = args.includes('--apply');
  if (!file || (dbVar !== 'MONGODB_URI' && dbVar !== 'MONGODB_URI_LIVE') || !process.env[dbVar]) throw new Error('Usage: --file <xlsx> --db MONGODB_URI|MONGODB_URI_LIVE [--apply]');
  const { rows, skipped } = readRows(file);

  // One client per phone number. The same name with several phones gets the phone appended (name must be unique).
  const clients = new Map<string, { first: Row; rows: Row[]; name: string }>();
  for (const r of rows) {
    const c = clients.get(r.mobile);
    if (c) c.rows.push(r); else clients.set(r.mobile, { first: r, rows: [r], name: r.name });
  }
  const phonesByName = new Map<string, Set<string>>();
  for (const [mobile, c] of clients) { const k = normalizeName(c.name); (phonesByName.get(k) ?? phonesByName.set(k, new Set()).get(k)!).add(mobile); }
  for (const [mobile, c] of clients) if (phonesByName.get(normalizeName(c.name))!.size > 1) c.name = `${c.name} (${mobile})`;
  const names = new Map<string, string>();
  for (const [mobile, c] of clients) {
    const k = normalizeName(c.name);
    if (names.has(k)) throw new Error(`Name collision after suffixing: ${c.name} (${mobile} vs ${names.get(k)})`);
    names.set(k, mobile);
  }

  const uri = process.env[dbVar]!;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Target ${dbVar}: ${describeMongoUri(uri)}  mode=${apply ? 'APPLY' : 'dry-run'}`);
  const bds = new Map((await BD.find().lean()).map(b => [b.email, b]));
  const missingBDs = [...new Set(rows.filter(r => !bds.has(r.bdEmail)).map(r => r.bdEmail))];
  if (missingBDs.length) throw new Error(`Requestees not found: ${missingBDs.join(', ')}`);

  const existing = await Client.find({ $or: [{ normalizedMobile: { $in: [...clients.keys()] } }, { normalizedName: { $in: [...names.keys()] } }] }).lean();
  if (existing.length) {
    console.log('Existing clients that clash (nothing is written):', existing.map(c => `${c.name} ${c.mobile}`));
    throw new Error('Clashes with existing clients; resolve before importing.');
  }

  const report = { clients: 0, associations: 0, distributions: 0, distributionsSkipped: [] as string[] };
  for (const [mobile, c] of clients) {
    const assocTypes = new Set<string>();
    const dist = c.rows.find(r => r.mode === 'IN_PERSON' || r.address.length >= 5);
    if (!dist) report.distributionsSkipped.push(`${c.name}: courier without address`);
    for (const r of c.rows) {
      const key = `${r.type}|${r.bdEmail}`;
      if (!assocTypes.has(key)) { assocTypes.add(key); report.associations++; }
    }
    report.clients++;
    if (dist) report.distributions++;
    if (!apply) continue;
    const client = await Client.create({ name: c.name, normalizedName: normalizeName(c.name), mobile, normalizedMobile: mobile, email: c.first.email, quantity: c.first.qty });
    const done = new Set<string>();
    for (const r of c.rows) {
      const key = `${r.type}|${r.bdEmail}`;
      if (done.has(key)) continue;
      done.add(key);
      await ClientAssociation.create({ client: client._id, type: r.type, bd: bds.get(r.bdEmail)!._id });
    }
    if (dist) {
      const now = new Date();
      await SweetDistribution.create({
        client: client._id, distributionYear: YEAR, occasion: LEGACY_OCCASION, type: dist.type, bd: bds.get(dist.bdEmail)!._id,
        quantity: c.first.qty, mode: dist.mode, ...(dist.mode === 'COURIER' ? { address: dist.address } : {}),
        status: 'INITIATE', statusHistory: [{ status: 'INITIATE', at: now }], distributedAt: now, notes: '',
      });
    }
  }
  console.log(JSON.stringify({ rowsRead: rows.length + skipped.length, importedRows: rows.length, skipped, ...report }, null, 1));
  if (apply) console.log('Totals now:', { clients: await Client.countDocuments(), associations: await ClientAssociation.countDocuments(), distributions: await SweetDistribution.countDocuments() });
}

main().catch(e => { console.error('Import failed:', e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());

// Reconciles a "Diwali Boxes Info" sheet (Sheet2 by default, --sheet <name>) with the DB: new clients, missing Type/Requestee associations and
// missing Diwali distributions are created (status INITIATE); anything that differs from the DB is reported as a conflict.
//   npx tsx src/utils/syncSheetClients.ts --file <xlsx> --db MONGODB_URI|MONGODB_URI_LIVE [--patch <json>] [--decisions <json>] [--fresh] [--apply]
// --fresh: delete all clients, associations, distributions and proofs first, then load the sheet from scratch.
// --patch: {"<1-based data row>": {"name": "...", "mobile": "..."}} overrides for cells edited after the xlsx was exported.
// --decisions: {"rename": {"<mobile>": "<name>"}} conflicts the user has resolved. Dry run by default.
import dotenv from 'dotenv';
dotenv.config();
import dns from 'node:dns';
import fs from 'node:fs';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { describeMongoUri } from '../config/db.js';
import { Client } from '../models/Client.js';
import { ClientAssociation } from '../models/ClientAssociation.js';
import { SweetDistribution } from '../models/SweetDistribution.js';
import { BD } from '../models/BD.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { isClientType, ClientType, DistributionMode } from '../config/distribution.js';
import { LEGACY_OCCASION, occasionMatch } from '../config/occasions.js';
import { normalizeMobile, normalizeName } from './normalize.js';

dns.setServers(['8.8.8.8']);

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const YEAR = 2026;

interface Row { row: number; name: string; mobile: string; email: string; type: ClientType; bdEmail: string; qty: number; mode: DistributionMode; address: string; }

function readRows(file: string, sheetName: string, patch: Record<string, { name?: string; mobile?: string; address?: string }>) {
  const sheet = XLSX.readFile(file).Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }).slice(1)
    .filter(r => r.slice(0, 9).some(v => clean(v)));
  const rows: Row[] = [], skipped: { row: number; name: string; reason: string }[] = [];
  raw.forEach((r, i) => {
    const row = i + 1, p = patch[row] ?? {};
    const name = clean(p.name ?? r[0]);
    const phone = String(p.mobile ?? r[1]);
    if (!name && !clean(r[3])) return;
    if (!name) return void skipped.push({ row, name: '', reason: `no client name (phone ${phone})` });
    const mobile = normalizeMobile(phone.split(/[/\n]/)[0]);
    if (!/^\d{10}$/.test(mobile)) return void skipped.push({ row, name, reason: 'missing/invalid phone' });
    let type = clean(r[3]);
    if (/^govt\.? official$/i.test(type)) type = 'Govt. Official';
    const modeText = clean(r[7]).toLowerCase().replace(/\s/g, '');
    const mode = modeText === 'courier' ? 'COURIER' : modeText === 'inperson' ? 'IN_PERSON' : null;
    const qty = Number(r[6]);
    if (!isClientType(type) || !mode || !Number.isInteger(qty) || qty < 1) return void skipped.push({ row, name, reason: `invalid type/mode/quantity (${type}/${clean(r[7])}/${r[6]})` });
    rows.push({ row, name, mobile, email: clean(r[2]).toLowerCase(), type, bdEmail: clean(r[5]).toLowerCase(), qty, mode, address: String(p.address ?? r[8] ?? '').trim().replace(/[ \t]+/g, ' ') });
  });
  return { rows, skipped };
}

const sameAddress = (a = '', b = '') => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

async function main() {
  const file = option('--file'), dbVar = option('--db'), apply = args.includes('--apply'), fresh = args.includes('--fresh');
  // --add-quantities: a client's quantity is the sum of its rows, added on top of an existing INITIATE distribution.
  const addQuantities = args.includes('--add-quantities');
  if (!file || (dbVar !== 'MONGODB_URI' && dbVar !== 'MONGODB_URI_LIVE') || !process.env[dbVar]) throw new Error('Usage: --file <xlsx> --db MONGODB_URI|MONGODB_URI_LIVE [--patch <json>] [--decisions <json>] [--sheet <name>] [--add-quantities] [--fresh] [--apply]');
  const patch = option('--patch') ? JSON.parse(fs.readFileSync(option('--patch')!, 'utf8')) : {};
  const decisions: { rename?: Record<string, string> } = option('--decisions') ? JSON.parse(fs.readFileSync(option('--decisions')!, 'utf8')) : {};
  const { rows, skipped } = readRows(file, option('--sheet') ?? 'Sheet2', patch);

  const groups = new Map<string, Row[]>();
  for (const r of rows) (groups.get(r.mobile) ?? groups.set(r.mobile, []).get(r.mobile)!).push(r);
  // Sheet name per phone; a name shared by several phones gets the phone appended (client names are unique).
  const sheetNames = new Map<string, string>();
  for (const [mobile, group] of groups) {
    const names = [...new Set(group.map(r => r.name))];
    const name = decisions.rename?.[mobile] ?? (names.length === 1 ? names[0] : undefined);
    if (name) sheetNames.set(mobile, name);
  }
  const phonesByName = new Map<string, number>();
  // Names the user decided are used exactly as given.
  const undecided = [...sheetNames].filter(([mobile]) => !decisions.rename?.[mobile]);
  for (const [, name] of undecided) phonesByName.set(normalizeName(name), (phonesByName.get(normalizeName(name)) ?? 0) + 1);
  for (const [mobile, name] of undecided) if (phonesByName.get(normalizeName(name))! > 1) sheetNames.set(mobile, `${name} (${mobile})`);

  const uri = process.env[dbVar]!;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Target ${dbVar}: ${describeMongoUri(uri)}  mode=${apply ? 'APPLY' : 'dry-run'}${fresh ? ' fresh' : ''}`);
  const bds = new Map((await BD.find().lean()).map(b => [b.email, b]));
  const missingBDs = [...new Set(rows.filter(r => !bds.has(r.bdEmail)).map(r => r.bdEmail))];
  if (missingBDs.length) throw new Error(`Requestees not found: ${missingBDs.join(', ')}`);

  if (fresh && apply) {
    // Clears all client data (BDs, users and occasions are kept). Take a verified backup first.
    for (const model of [SweetDistribution, DeliveryProof, ClientAssociation, Client] as mongoose.Model<any>[]) {
      console.log(`Deleted ${(await model.deleteMany({})).deletedCount} ${model.collection.name}`);
    }
  }
  const clientsByMobile = new Map((fresh ? [] : await Client.find().lean()).map(c => [c.normalizedMobile, c]));
  const clientsByName = new Map([...clientsByMobile.values()].map(c => [c.normalizedName, c]));
  const conflicts: string[] = [];
  type ClientRecord = NonNullable<ReturnType<typeof clientsByMobile.get>>;
  const plan = { newClients: [] as string[], renames: [] as string[], associations: [] as string[], distributions: [] as string[], quantityUpdates: [] as string[] };

  for (const [mobile, group] of groups) {
    const names = [...new Set(group.map(r => r.name))];
    let client: ClientRecord | undefined = clientsByMobile.get(mobile);
    const decided = decisions.rename?.[mobile];
    const wanted = sheetNames.get(mobile);
    if (!wanted) { conflicts.push(`${mobile}: one phone, several names in sheet: ${names.join(' | ')}${client ? ` (DB: ${client.name})` : ''}`); continue; }
    const holder = clientsByName.get(normalizeName(wanted));
    if (holder && holder.normalizedMobile !== mobile) {
      conflicts.push(`${mobile} "${wanted}": name already used by another client (${holder.name}, ${holder.mobile})`); continue;
    }
    if (client && client.normalizedName !== normalizeName(wanted)) {
      // Names suffixed with the phone by the first import are the same client.
      if (!decided && client.name !== `${wanted} (${mobile})`) { conflicts.push(`${mobile}: DB name "${client.name}" vs sheet "${wanted}"`); continue; }
      if (decided) {
        plan.renames.push(`${client.name} -> ${wanted}`);
        if (apply) await Client.updateOne({ _id: client._id }, { $set: { name: wanted, normalizedName: normalizeName(wanted) } });
      }
    }
    if (!client) {
      plan.newClients.push(`${wanted} ${mobile}`);
      if (apply) client = (await Client.create({ name: wanted, normalizedName: normalizeName(wanted), mobile, normalizedMobile: mobile, email: group[0].email, quantity: group[0].qty })).toObject() as unknown as ClientRecord;
      if (client) { clientsByMobile.set(mobile, client); clientsByName.set(client.normalizedName, client); }
    }
    const clientId = client?._id;
    const assocs = clientId ? await ClientAssociation.find({ client: clientId }).lean() : [];
    const seen = new Set<string>();
    for (const r of group) {
      const bd = bds.get(r.bdEmail)!;
      const key = `${r.type}|${bd._id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (assocs.some(a => a.type === r.type && String(a.bd) === String(bd._id))) continue;
      plan.associations.push(`${wanted}: ${r.type} / ${r.bdEmail}`);
      if (apply) await ClientAssociation.create({ client: clientId, type: r.type, bd: bd._id });
    }
    const dist = clientId ? await SweetDistribution.findOne({ client: clientId, distributionYear: YEAR, occasion: occasionMatch(LEGACY_OCCASION), isReverted: { $ne: true } }).lean() : null;
    const src = group.find(r => r.mode === 'IN_PERSON' || r.address.length >= 5);
    const total = addQuantities ? group.reduce((sum, r) => sum + r.qty, 0) : src?.qty ?? 0;
    if (!dist) {
      if (!src) { conflicts.push(`${mobile} "${wanted}": courier without address, cannot initiate`); continue; }
      plan.distributions.push(`${wanted}: ${total} ${src.mode}`);
      if (apply) {
        const now = new Date();
        if (addQuantities) await Client.updateOne({ _id: clientId }, { $set: { quantity: total } });
        await SweetDistribution.create({
          client: clientId, distributionYear: YEAR, occasion: LEGACY_OCCASION, type: src.type, bd: bds.get(src.bdEmail)!._id,
          quantity: total, mode: src.mode, ...(src.mode === 'COURIER' ? { address: src.address } : {}),
          status: 'INITIATE', statusHistory: [{ status: 'INITIATE', at: now }], distributedAt: now, notes: '',
        });
      }
    } else if (addQuantities) {
      // Existing client from another sheet: keep its mode/requestee, add this sheet's boxes.
      if (dist.status !== 'INITIATE') { conflicts.push(`${mobile} "${wanted}": distribution is ${dist.status}, quantity not changed`); continue; }
      const quantity = (dist.quantity ?? 0) + total;
      plan.quantityUpdates.push(`${wanted}: ${dist.quantity} + ${total} = ${quantity}`);
      if (apply) {
        await SweetDistribution.updateOne({ _id: dist._id }, { $set: { quantity } });
        await Client.updateOne({ _id: clientId }, { $set: { quantity } });
      }
    } else if (src) {
      const diffs: string[] = [];
      if (dist.quantity !== src.qty) diffs.push(`qty DB ${dist.quantity} / sheet ${src.qty}`);
      if (dist.mode !== src.mode) diffs.push(`mode DB ${dist.mode} / sheet ${src.mode}`);
      if (src.mode === 'COURIER' && !sameAddress(dist.address, src.address)) diffs.push('address differs');
      if (diffs.length) conflicts.push(`${mobile} "${wanted}" (status ${dist.status}): ${diffs.join(', ')}`);
    }
  }

  const sheetMobiles = new Set(groups.keys());
  const withDist = new Set((await SweetDistribution.find({ distributionYear: YEAR, occasion: occasionMatch(LEGACY_OCCASION), isReverted: { $ne: true } }).distinct('client')).map(String));
  const notInSheetNoDist = [...clientsByMobile.values()].filter(c => !sheetMobiles.has(c.normalizedMobile) && !withDist.has(String(c._id))).map(c => `${c.name} ${c.mobile}`);

  console.log(JSON.stringify({ sheetRows: rows.length, sheetClients: groups.size, skipped, conflicts, plan, dbClientsNotInSheetWithoutDistribution: notInSheetNoDist }, null, 1));
}

main().catch(e => { console.error('Sync failed:', e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());

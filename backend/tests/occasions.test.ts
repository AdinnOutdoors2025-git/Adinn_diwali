// Run: npx tsx tests/occasions.test.ts   (in-memory MongoDB only; touches no real data)
// Covers the persistent Occasion list (defaults, add, case-insensitive duplicates, authorization), per-occasion
// distributions (one per client per occasion per year), filters, history, status updates and legacy Diwali records.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import clientRoutes from '../src/routes/clientRoutes.js';
import distributionRoutes from '../src/routes/distributionRoutes.js';
import occasionRoutes from '../src/routes/occasionRoutes.js';
import { generateToken } from '../src/config/jwt.js';
import { DEFAULT_OCCASIONS, LEGACY_OCCASION } from '../src/config/occasions.js';
import { ensureClientIndexes } from '../src/models/Client.js';
import { ensureAssociationIndexes } from '../src/models/ClientAssociation.js';
import { SweetDistribution, ensureDistributionIndexes } from '../src/models/SweetDistribution.js';
import { Occasion, ensureOccasions } from '../src/models/Occasion.js';
import { BD } from '../src/models/BD.js';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

async function main() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ensureClientIndexes(); await ensureAssociationIndexes();
  // Simulate the pre-occasion database: the old one-per-year unique index plus a legacy record with no occasion field.
  await SweetDistribution.createCollection();
  await SweetDistribution.collection.createIndex({ client: 1, distributionYear: 1 }, { unique: true, name: 'active_client_year_unique', partialFilterExpression: { isReverted: false } });
  const app = express(); app.use(express.json());
  app.use('/api/clients', clientRoutes); app.use('/api/distributions', distributionRoutes); app.use('/api/occasions', occasionRoutes);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokenFor = (role: string) => ({ Authorization: `Bearer ${generateToken({ id: new mongoose.Types.ObjectId().toString(), name: 'T', email: 't@adinn.com', role: role as any })}` });
  const auth = tokenFor('STAFF');
  const call = async (method: string, path: string, body?: object, headers: Record<string, string> = auth) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
  let phone = 9200000000;
  try {
    const bd = await BD.create({ name: 'Req', email: 'req@adinn.com' });
    const newClient = async (name: string) => (await call('POST', '/clients', { quantity: 3, name, mobile: String(++phone), type: 'Vendor', bd: String(bd._id) })).body.data.clientId as string;
    const give = (clientId: string, over: object = {}) => call('POST', '/distributions', { clientId, year: 2026, type: 'Vendor', bd: String(bd._id), mode: 'IN_PERSON', ...over });
    const row = async (clientId: string, occasion?: string, extra = '') => (await call('GET', `/distributions?year=2026&limit=100${occasion ? `&occasion=${encodeURIComponent(occasion)}` : ''}${extra}`)).body.data.find((r: any) => r.clientId === clientId);

    // A legacy Diwali record written before occasions existed (no `occasion` field).
    const legacyClient = await newClient('Legacy Co');
    const legacyAssoc = (await mongoose.connection.db!.collection('clientassociations').findOne({ client: new mongoose.Types.ObjectId(legacyClient) }))!;
    const legacyDoc = await SweetDistribution.collection.insertOne({ client: new mongoose.Types.ObjectId(legacyClient), distributionYear: 2026, type: 'Vendor', bd: bd._id, quantity: 5, mode: 'IN_PERSON', status: 'DELIVERED',
      statusHistory: [], distributedAt: new Date(), isReverted: false, createdAt: new Date(), updatedAt: new Date() });
    assert.equal((await SweetDistribution.collection.findOne({ _id: legacyDoc.insertedId }))!.occasion, undefined);
    await ensureOccasions(); await ensureOccasions(); await ensureDistributionIndexes(); await ensureDistributionIndexes();
    ok('startup migration is idempotent'); void legacyAssoc;

    // ---- Occasion list ----
    const names = await Occasion.find().lean(); assert.deepEqual(names.map(o => o.name).sort(), [...DEFAULT_OCCASIONS].sort()); assert.ok(names.every(o => o.isDefault)); ok('defaults Diwali, Pongal, Christmas and New Year are seeded exactly once');
    const list = await call('GET', '/occasions'); assert.equal(list.status, 200); assert.deepEqual(list.body.data.map((o: any) => o.name), [...DEFAULT_OCCASIONS]); ok('GET /occasions returns the defaults in order, for any logged-in user');
    assert.equal((await call('GET', '/occasions', undefined, {})).status, 401); assert.equal((await call('POST', '/occasions', { name: 'Holi' }, {})).status, 401);
    assert.equal((await call('POST', '/occasions', { name: 'Holi' }, tokenFor('GUEST'))).status, 403); ok('listing and adding occasions require authentication; unknown roles cannot add');
    const holi = await call('POST', '/occasions', { name: '  Holi   Festival ' });
    assert.equal(holi.status, 201); assert.equal(holi.body.data.name, 'Holi Festival'); assert.equal(holi.body.data.isDefault, false); ok('a new occasion is trimmed, collapsed and saved');
    assert.ok((await call('GET', '/occasions', undefined, tokenFor('CMD'))).body.data.some((o: any) => o.name === 'Holi Festival')); ok('a new occasion is visible to every user');
    for (const dup of ['holi festival', 'HOLI FESTIVAL', '  holi   festival  ', 'diwali', ' DIWALI', 'new   YEAR', 'Pongal']) {
      const r = await call('POST', '/occasions', { name: dup }); assert.equal(r.status, 409, dup);
    }
    assert.equal(await Occasion.countDocuments(), 5); ok('duplicates are rejected case-insensitively after trimming; nothing extra is stored');
    for (const bad of [undefined, '', '   ', 'x', 'a'.repeat(51), '<script>', 'Ho;li', 12, null, '--']) assert.equal((await call('POST', '/occasions', { name: bad })).status, 400, String(bad));
    ok('missing, too short, too long, non-string and unsafe names are rejected');
    const races = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/occasions', { name: 'Onam' })));
    assert.equal(races.filter(r => r.status === 201).length, 1); assert.equal(races.filter(r => r.status === 409).length, 7); assert.equal(await Occasion.countDocuments({ normalizedName: 'onam' }), 1); ok('8 concurrent identical adds create exactly one occasion');

    // ---- Legacy migration ----
    const migrated = await SweetDistribution.collection.findOne({ _id: legacyDoc.insertedId }); assert.equal(migrated!.occasion, LEGACY_OCCASION); ok('existing records are tagged Diwali and otherwise unchanged');
    const idx = (await SweetDistribution.collection.indexes()).map(i => i.name); assert.ok(idx.includes('active_client_year_occasion_unique')); assert.ok(!idx.includes('active_client_year_unique')); ok('the one-per-year index is replaced by a one-per-occasion-per-year index');
    const legacyRow = await row(legacyClient); assert.equal(legacyRow.isEligible, false); assert.equal(legacyRow.currentYearDistribution.occasion, 'Diwali'); ok('with no occasion in the request the Entry data is Diwali, including legacy records');
    assert.equal((await row(legacyClient, 'Diwali')).isEligible, false); assert.equal((await row(legacyClient, 'diwali')).isEligible, false); ok('occasion names are matched case-insensitively');
    const pongalLegacy = await row(legacyClient, 'Pongal'); assert.equal(pongalLegacy.isEligible, true); assert.equal(pongalLegacy.currentYearDistribution, null); assert.equal(pongalLegacy.lastGiven, null); ok('a Diwali record does not appear in, or block, another occasion');

    // ---- Per-occasion distributions ----
    const client = await newClient('Multi Co');
    const diwali = await give(client); assert.equal(diwali.status, 201); assert.equal(diwali.body.data.occasion, 'Diwali');
    assert.equal((await give(client)).status, 409); assert.equal((await give(client, { occasion: 'diwali' })).status, 409); ok('the same client cannot receive the same occasion twice in a year (omitted or any-case name)');
    const pongal = await give(client, { occasion: 'pongal' }); assert.equal(pongal.status, 201); assert.equal(pongal.body.data.occasion, 'Pongal'); assert.match(pongal.body.message, /^Pongal sweets for 2026/); ok('the same client can receive a different occasion in the same year; the name is stored canonically');
    assert.equal((await give(client, { occasion: 'Pongal' })).status, 409); assert.match((await give(client, { occasion: 'Pongal' })).body.message, /already received Pongal sweets/); ok('the duplicate message names the occasion');
    assert.equal((await give(client, { occasion: 'Nope' })).status, 400); assert.equal((await give(client, { occasion: 123 })).status, 400); assert.equal(await SweetDistribution.countDocuments({ client }), 2); ok('an unknown occasion is rejected and nothing is saved');
    assert.equal((await give(client, { occasion: 'Christmas', year: 2027 })).status, 201); ok('a different year is still allowed for the same occasion');

    // ---- Filtering, status, history ----
    const d = await row(client, 'Diwali'), p = await row(client, 'Pongal'), c = await row(client, 'Christmas');
    assert.equal(d.currentYearDistribution._id, diwali.body.data._id); assert.equal(p.currentYearDistribution._id, pongal.body.data._id); assert.equal(c.isEligible, true); ok('each occasion shows only its own record for the year');
    const given = (await call('GET', '/distributions?year=2026&occasion=Pongal&status=GIVEN&limit=100')).body.data.map((r: any) => r.clientId);
    assert.deepEqual(given, [client]); const notGiven = (await call('GET', '/distributions?year=2026&occasion=Pongal&status=NOT_GIVEN&limit=100')).body.data.map((r: any) => r.clientId);
    assert.ok(notGiven.includes(legacyClient) && !notGiven.includes(client)); ok('Given / Not Given filters are scoped to the selected occasion');
    assert.deepEqual((await call('GET', '/distributions?year=2026&occasion=Pongal&mode=IN_PERSON&deliveryStatus=INITIATE&limit=100')).body.data.filter((r: any) => !r.isEligible).map((r: any) => r.clientId), [client]);
    assert.deepEqual((await call('GET', '/distributions?year=2026&occasion=Christmas&mode=IN_PERSON&limit=100')).body.data.filter((r: any) => !r.isEligible), []); ok('mode and delivery-stage filters are scoped to the selected occasion');
    assert.equal((await call('GET', '/distributions?year=2026&occasion=Nope')).status, 400); assert.equal((await call('GET', '/distributions?year=2026&occasion=Pongal&search=Multi')).body.data.length, 1); ok('unknown occasions are rejected on the list; search works within an occasion');
    const christmas27 = (await call('GET', '/distributions?year=2027&occasion=Christmas&limit=100')).body.data.find((r: any) => r.clientId === client);
    assert.equal(christmas27.lastGiven, 2027); assert.equal((await row(client, 'Pongal')).lastGiven, 2026); assert.equal(c.lastGiven, 2027); assert.equal((await row(legacyClient, "Christmas")).lastGiven, null); ok('distribution history (Last Given) is per occasion');
    const stepped = await call('PATCH', `/distributions/${pongal.body.data._id}/status`, { status: 'DELIVERED' }); assert.equal(stepped.status, 200);
    assert.equal((await SweetDistribution.findById(diwali.body.data._id))!.status, 'INITIATE'); assert.equal((await row(client, 'Pongal')).currentYearDistribution.status, 'DELIVERED'); ok('a status update changes only that occasion record');
    assert.equal((await call('POST', `/distributions/${pongal.body.data._id}/revert`, { reason: 'Entered by mistake' })).status, 200);
    assert.equal((await row(client, 'Pongal')).isEligible, true); assert.equal((await row(client, 'Diwali')).isEligible, false); assert.equal((await give(client, { occasion: 'Pongal' })).status, 201); ok('reverting one occasion frees only that occasion, which can then be recorded again');
    const custom = await give(await newClient('Custom Co'), { occasion: 'Holi Festival' }); assert.equal(custom.status, 201); assert.equal(custom.body.data.occasion, 'Holi Festival');
    assert.equal((await call('GET', '/distributions?year=2026&occasion=Holi%20Festival&status=GIVEN')).body.data.length, 1); ok('a user-added occasion works end to end');

    // ---- Revert details (shown in the details popup) ----
    const revClient = await newClient('Revert Co');
    assert.deepEqual((await row(revClient, 'Pongal')).revertHistory, []); ok('a client that was never reverted has an empty revert history');
    const first = await give(revClient, { occasion: 'Pongal' }); const beforeFirst = Date.now();
    assert.equal((await call('POST', `/distributions/${first.body.data._id}/revert`, { reason: '  Wrong address entered  ' })).status, 200);
    const firstDoc = (await SweetDistribution.findById(first.body.data._id))!;
    assert.ok(firstDoc.revertedAt instanceof Date && Math.abs(firstDoc.revertedAt.getTime() - beforeFirst) < 60000); assert.equal(firstDoc.revertReason, 'Wrong address entered'); ok('a revert saves a server-generated timestamp and the trimmed reason in MongoDB');
    const afterFirst = await row(revClient, 'Pongal'); assert.equal(afterFirst.isEligible, true); assert.equal(afterFirst.revertHistory.length, 1);
    assert.equal(afterFirst.revertHistory[0].reason, 'Wrong address entered'); assert.equal(new Date(afterFirst.revertHistory[0].revertedAt).getTime(), firstDoc.revertedAt!.getTime());
    assert.equal(afterFirst.revertHistory[0].mode, 'IN_PERSON'); ok('the list API returns the revert time and reason, even while the client is eligible again');
    assert.ok(!JSON.stringify(afterFirst.revertHistory).includes('revertedBy')); ok('revert history does not expose user ids');
    await new Promise(resolve => setTimeout(resolve, 15));
    const second = await give(revClient, { occasion: 'Pongal' }); assert.equal(second.status, 201);
    assert.equal((await call('POST', `/distributions/${second.body.data._id}/revert`, { reason: 'Client asked to cancel' })).status, 200);
    assert.equal((await call('POST', `/distributions/${second.body.data._id}/revert`, { reason: 'Reverting again by mistake' })).status, 404); ok('a record already reverted cannot be reverted again or have its reason overwritten');
    const third = await give(revClient, { occasion: 'Pongal' }); assert.equal(third.status, 201);
    const multi = await row(revClient, 'Pongal');
    assert.equal(multi.isEligible, false); assert.deepEqual(multi.revertHistory.map((entry: any) => entry.reason), ['Client asked to cancel', 'Wrong address entered']);
    assert.ok(new Date(multi.revertHistory[0].revertedAt).getTime() > new Date(multi.revertHistory[1].revertedAt).getTime()); ok('each revert is kept with its own time and reason, newest first, alongside the active record');
    assert.equal((await SweetDistribution.findById(first.body.data._id))!.revertReason, 'Wrong address entered'); ok('earlier revert entries are never overwritten');
    assert.deepEqual((await row(revClient, 'Diwali')).revertHistory, []); assert.deepEqual((await row(revClient, 'Pongal', '&search=Revert')).revertHistory.length, 2); ok('revert history is scoped to the selected occasion');
    const yearly = await call('GET', '/distributions?year=2027&occasion=Pongal&limit=100'); assert.deepEqual(yearly.body.data.find((r: any) => r.clientId === revClient).revertHistory, []); ok('revert history is scoped to the selected year');
    const oldRevertClient = await newClient('Old Revert Co');
    await SweetDistribution.collection.insertOne({ client: new mongoose.Types.ObjectId(oldRevertClient), distributionYear: 2026, type: 'Vendor', bd: bd._id, quantity: 5, mode: 'IN_PERSON', status: 'INITIATE',
      statusHistory: [], distributedAt: new Date(), isReverted: true, createdAt: new Date(), updatedAt: new Date() });
    const legacyHistory = (await call('GET', '/distributions?year=2026&limit=100')).body.data.find((r: any) => r.clientId === oldRevertClient).revertHistory;
    assert.equal(legacyHistory.length, 1); assert.equal(legacyHistory[0].revertedAt, null); assert.equal(legacyHistory[0].reason, null); ok('an older reverted record without a timestamp or reason is returned with nulls (shown as Not recorded)');

    console.log(`\n${passed} checks passed`);
  } finally { server.close(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });

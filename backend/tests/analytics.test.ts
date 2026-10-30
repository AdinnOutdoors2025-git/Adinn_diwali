// Run: npx tsx tests/analytics.test.ts  (uses an in-memory MongoDB; touches no real data)
// Home analytics: Total Entries counts registered clients (with or without a distribution); Delivered / Pending / Quantity follow
// the active distributions of the selected occasion and year.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import clientRoutes from '../src/routes/clientRoutes.js';
import distributionRoutes from '../src/routes/distributionRoutes.js';
import { generateToken } from '../src/config/jwt.js';
import { Client, ensureClientIndexes } from '../src/models/Client.js';
import { ensureAssociationIndexes } from '../src/models/ClientAssociation.js';
import { ensureDistributionIndexes } from '../src/models/SweetDistribution.js';
import { ensureOccasions } from '../src/models/Occasion.js';
import { BD } from '../src/models/BD.js';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

async function main() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ensureClientIndexes(); await ensureAssociationIndexes(); await ensureOccasions(); await ensureDistributionIndexes();
  const app = express(); app.use(express.json());
  app.use('/api/clients', clientRoutes); app.use('/api/distributions', distributionRoutes);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = generateToken({ id: new mongoose.Types.ObjectId().toString(), name: 'Tester', email: 't@adinn.com', role: 'STAFF' });
  const call = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() as any };
  };
  const stats = async (query = 'year=2026&occasion=Diwali') => { const r = await call('GET', `/distributions/analytics?${query}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data; };
  const summary = (d: any) => [d.totalEntries, d.delivered, d.pending, d.totalQuantity];
  try {
    const bd = await BD.create({ name: 'BD One', email: 'one@adinn.com' });
    assert.deepEqual(summary(await stats()), [0, 0, 0, 0]); ok('no clients: everything is 0');

    let phone = 9000000000;
    const add = async (name: string, quantity: number) => (await call('POST', '/clients', { name, mobile: String(++phone), type: 'Vendor', bd: String(bd._id), quantity })).body.data.clientId as string;
    const first = await add('Client One', 4), second = await add('Client Two', 6);
    assert.deepEqual(summary(await stats()), [2, 0, 0, 10]); ok('2 registered clients with zero distributions: Total Entries is 2, Delivered 0, Pending 0, Total Quantity is their saved quantities');
    assert.equal((await stats('year=2027&occasion=Pongal')).totalEntries, 2); ok('registered clients show under any occasion and year');

    const give = (clientId: string) => call('POST', '/distributions', { clientId, year: 2026, type: 'Vendor', bd: String(bd._id), mode: 'IN_PERSON' });
    const d1 = await give(first); assert.equal(d1.status, 201);
    assert.deepEqual(summary(await stats()), [2, 0, 1, 10]); ok('a distribution makes its client Pending without changing Total Entries');
    assert.equal((await stats('year=2027&occasion=Diwali')).pending, 0); assert.equal((await stats('year=2026&occasion=Pongal')).pending, 0); ok('Delivered / Pending follow the selected occasion and year');
    const advance = await fetch(`${base}/distributions/${d1.body.data._id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: 'DELIVERED' }) });
    assert.equal(advance.status, 200);
    let d = await stats(); assert.deepEqual([d.totalEntries, d.delivered, d.pending, d.deliveredQuantity, d.pendingQuantity], [2, 1, 0, 4, 0]); ok('marking Delivered moves it from Pending to Delivered');
    const d2 = await give(second); assert.equal(d2.status, 201);
    d = await stats(); assert.deepEqual([d.totalEntries, d.delivered, d.pending, d.pendingQuantity], [2, 1, 1, 6]);
    assert.equal((await call('POST', `/distributions/${d2.body.data._id}/revert`, { reason: 'entered by mistake' })).status, 200);
    d = await stats(); assert.deepEqual([d.totalEntries, d.delivered, d.pending, d.totalQuantity], [2, 1, 0, 10]); ok('a reverted distribution is not counted as Delivered or Pending, and the client is still registered');

    // Distribution records are never counted as clients: a client with two distributions across occasions/years counts once.
    assert.equal(await Client.countDocuments(), 2); assert.equal((await stats('year=2026&occasion=Diwali')).totalEntries, 2); ok('Total Entries counts clients, not distribution records');

    // Older clients without a stored quantity fall back to their distribution's quantity (or 0).
    await mongoose.connection.collection('clients').insertOne({ name: 'Old Client', normalizedName: 'old client', mobile: '8000000001', normalizedMobile: '8000000001', createdAt: new Date(), updatedAt: new Date() });
    d = await stats(); assert.deepEqual([d.totalEntries, d.totalQuantity], [3, 10]); ok('an older client with no quantity is counted as a client and adds 0 quantity');

    assert.equal((await call('GET', '/distributions/analytics?year=abc')).status, 400); assert.equal((await call('GET', '/distributions/analytics?year=2026&occasion=Nope')).status, 400); ok('invalid year or unknown occasion is rejected');
    console.log(`\n${passed} checks passed`);
  } finally { server.close(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error('FAIL:', error); process.exit(1); });

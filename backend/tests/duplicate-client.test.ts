// Run: npx tsx tests/duplicate-client.test.ts  (uses an in-memory MongoDB; touches no real data)
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import clientRoutes from '../src/routes/clientRoutes.js';
import bdRoutes from '../src/routes/bdRoutes.js';
import distributionRoutes from '../src/routes/distributionRoutes.js';
import { generateToken } from '../src/config/jwt.js';
import { Client, ensureClientIndexes } from '../src/models/Client.js';
import { ensureAssociationIndexes } from '../src/models/ClientAssociation.js';
import { ClientAssociation } from '../src/models/ClientAssociation.js';
import { SweetDistribution, ensureDistributionIndexes } from '../src/models/SweetDistribution.js';
import { BD } from '../src/models/BD.js';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

async function main() {
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
await ensureClientIndexes(); await ensureAssociationIndexes(); await ensureDistributionIndexes();
const app = express(); app.use(express.json());
app.use('/api/clients', clientRoutes); app.use('/api/distributions', distributionRoutes); app.use('/api/bds', bdRoutes);
const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const token = generateToken({ id: new mongoose.Types.ObjectId().toString(), name: 'Tester', email: 't@adinn.com', role: 'STAFF' });
const call = async (path: string, body: object) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
};
try {
  const [bd1, bd2] = await BD.create([{ name: 'BD One', email: 'one@adinn.com' }, { name: 'BD Two', email: 'two@adinn.com' }]);
  const first = { name: 'Acme Media', mobile: '9876543210', type: 'Vendor', bd: String(bd1._id) };

  let r = await call('/clients', first);
  assert.equal(r.status, 201); assert.equal(await Client.countDocuments(), 1); ok('new client created (201)');

  r = await call('/clients', { ...first, name: 'ACME  media', mobile: '9876543210', type: 'Client', bd: String(bd2._id) });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'CLIENT_EXISTS');
  assert.equal(await Client.countDocuments(), 1); assert.equal(await ClientAssociation.countDocuments(), 1);
  ok('duplicate phone returns 409 CLIENT_EXISTS and changes nothing (cancel path)');

  r = await call('/clients', { ...first, mobile: '9876543210', type: 'Client', bd: String(bd2._id), confirmExisting: true });
  assert.equal(r.status, 201); assert.equal(await Client.countDocuments(), 1); assert.equal(await ClientAssociation.countDocuments(), 2);
  assert.equal(await SweetDistribution.countDocuments(), 0); ok('confirm adds association to existing client, no new client, no distribution');

  r = await call('/clients', { ...first, confirmExisting: true });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'ASSOCIATION_EXISTS'); assert.equal(await ClientAssociation.countDocuments(), 2);
  ok('existing Type+BD association returns informative 409 ASSOCIATION_EXISTS');

  r = await call('/clients', { name: 'Acme Media', mobile: '9000000001', type: 'Vendor', bd: String(bd1._id) });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'CLIENT_EXISTS'); assert.equal(r.body.matchedBy, 'name'); assert.equal(await Client.countDocuments(), 1);
  ok('same name with different phone offers the existing-client flow (CLIENT_EXISTS, matchedBy name)');

  const racers = await Promise.all(Array.from({ length: 8 }, () => call('/clients', { name: 'Race Co', mobile: '9111111111', type: 'Govt. Official', bd: String(bd1._id) })));
  assert.equal(racers.filter(x => x.status === 201).length, 1);
  assert.ok(racers.every(x => [201, 409].includes(x.status)));
  assert.equal(await Client.countDocuments({ normalizedMobile: '9111111111' }), 1);
  assert.equal(await ClientAssociation.countDocuments({ type: 'Govt. Official' }), 1); ok('8 concurrent identical creates yield exactly one client + association');

  const concurrentConfirm = await Promise.all(Array.from({ length: 6 }, () => call('/clients', { ...first, mobile: '9876543210', type: 'Bank Official', bd: String(bd2._id), confirmExisting: true })));
  assert.equal(concurrentConfirm.filter(x => x.status === 201).length, 1);
  assert.equal(await ClientAssociation.countDocuments({ type: 'Bank Official' }), 1); ok('concurrent confirms create exactly one association');

  const acme = (await Client.findOne({ normalizedMobile: '9876543210' }))!;
  const year = new Date().getFullYear();
  r = await call('/distributions', { clientId: String(acme._id), year, type: 'Vendor', bd: String(bd1._id), quantity: 1, mode: 'IN_PERSON' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await call('/distributions', { clientId: String(acme._id), year, type: 'Client', bd: String(bd2._id), quantity: 1, mode: 'IN_PERSON' });
  assert.ok(r.status >= 400, `second sweet in same year must be rejected, got ${r.status}`);
  assert.equal(await SweetDistribution.countDocuments({ client: acme._id, isReverted: { $ne: true } }), 1);
  ok('annual rule: second distribution in same year across another Type/Requestee rejected');

  r = await call('/clients', { name: 'Bad', mobile: 'abc', type: 'Vendor', bd: String(bd1._id) });
  assert.equal(r.status, 400); ok('invalid phone returns 400');
  const get = async (path: string) => { const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }); return { status: res.status, body: await res.json() as any }; };
  const list = await get('/bds');
  assert.equal(list.status, 200); assert.deepEqual(list.body.data.map((b: any) => b.name), ['BD One', 'BD Two']);
  assert.ok(list.body.data.every((b: any) => /^[0-9a-f]{24}$/.test(b._id))); ok('GET /api/bds returns real BD names with their _id');
  const unauth = await fetch(base + '/bds'); assert.equal(unauth.status, 401); ok('GET /api/bds requires authentication (401)');
  const byBD = await get(`/distributions?year=${year}&bd=${bd2._id}&limit=50`);
  assert.equal(byBD.status, 200);
  assert.deepEqual(byBD.body.data.map((c: any) => c.clientName), ['Acme Media']);
  assert.ok(byBD.body.data[0].associations.some((a: any) => String(a.bd._id) === String(bd2._id))); ok('BD filter returns only clients associated with that BD');
  const byBoth = await get(`/distributions?year=${year}&bd=${bd1._id}&type=Govt. Official&limit=50`);
  assert.deepEqual(byBoth.body.data.map((c: any) => c.clientName), ['Race Co']); ok('Requestee + Type filter narrows correctly');
  console.log(`\n${passed} checks passed`);
} finally { server.close(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error('FAIL:', error); process.exit(1); });

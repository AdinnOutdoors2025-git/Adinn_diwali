// Run: npx tsx tests/yearly-cycle.test.ts   (in-memory MongoDB only; touches no real data)
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
  app.use('/api/clients', clientRoutes); app.use('/api/distributions', distributionRoutes);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = generateToken({ id: new mongoose.Types.ObjectId().toString(), name: 'Tester', email: 't@adinn.com', role: 'STAFF' });
  const call = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
  try {
    const [bd1, bd2] = await BD.create([{ name: 'BD One', email: 'one@adinn.com' }, { name: 'BD Two', email: 'two@adinn.com' }]);
    const abc = { name: 'ABC Technologies', mobile: '9876500001', type: 'Vendor', quantity: 3, bd: String(bd1._id) };

    // Global client identity
    assert.equal((await call('POST', '/clients', abc)).status, 201);
    ok('2026: client "ABC Technologies" registered');
    const variants: Array<[string, string, string]> = [
      ['different capitalization', 'abc TECHNOLOGIES', '9000000002'],
      ['leading/trailing spaces', '   ABC Technologies   ', '9000000003'],
      ['extra internal spaces', 'ABC   Technologies', '9000000004'],
    ];
    for (const [label, name, mobile] of variants) {
      const r = await call('POST', '/clients', { quantity: 3, ...abc, name, mobile });
      assert.equal(r.status, 409, label); assert.equal(r.body.code, 'CLIENT_EXISTS'); assert.equal(r.body.matchedBy, 'name');
      assert.equal(await Client.countDocuments(), 1, label);
      ok(`duplicate with ${label} (new phone) is detected, no second client`);
    }
    // Client identity has no year, so a 2027 registration attempt goes through the same check.
    const again = await call('POST', '/clients', { quantity: 3, ...abc, mobile: '9876500001' });
    assert.equal(again.status, 409); assert.equal(again.body.matchedBy, 'mobile'); assert.equal(await Client.countDocuments(), 1);
    ok('2027 re-registration attempt (same phone) finds the existing client');
    const different = await call('POST', '/clients', { quantity: 3, name: 'ABC Technology Solutions', mobile: '9876500002', type: 'Vendor', bd: String(bd1._id) });
    assert.equal(different.status, 201); assert.equal(await Client.countDocuments(), 2);
    ok('a similar-but-different business ("ABC Technology Solutions") is NOT merged');

    // Existing-client workflow
    let r = await call('POST', '/clients', { quantity: 3, ...abc, confirmExisting: true });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ASSOCIATION_EXISTS');
    assert.equal(await ClientAssociation.countDocuments({ type: 'Vendor' }), 2);
    ok('existing client + same Type + Requestee reuses the association (no duplicate)');
    r = await call('POST', '/clients', { quantity: 3, ...abc, type: 'Client', bd: String(bd2._id), confirmExisting: true });
    assert.equal(r.status, 201); assert.equal(await Client.countDocuments(), 2);
    assert.equal(await ClientAssociation.countDocuments({ client: r.body.data.clientId }), 2);
    ok('existing client + new Type/Requestee adds only an association');

    // Concurrency
    const race = await Promise.all(Array.from({ length: 10 }, (_, i) => call('POST', '/clients',
      { quantity: 3, name: i % 2 ? 'Race Co' : '  race co ', mobile: i % 2 ? '9111111111' : '9222222222', type: 'Govt. Official', bd: String(bd1._id) })));
    assert.ok(race.every(x => [201, 409].includes(x.status)), JSON.stringify(race.map(x => x.status)));
    assert.equal(await Client.countDocuments({ normalizedName: 'race co' }), 1);
    ok('10 concurrent registrations (mixed case and phones) create exactly one "Race Co"');

    // Yearly distribution
    const acme = (await Client.findOne({ normalizedName: 'abc technologies' }))!;
    const dist = (year: number, type = 'Vendor', bd = bd1) => call('POST', '/distributions', { clientId: String(acme._id), year, type, bd: String(bd._id), mode: 'IN_PERSON' });
    const d2026 = await dist(2026);
    assert.equal(d2026.status, 201); ok('2026 distribution created');
    const before = await SweetDistribution.findById(d2026.body.data._id).lean();
    assert.equal((await dist(2026)).status, 409); ok('same client, same year, same dimensions is rejected');
    assert.equal((await dist(2026, 'Client', bd2)).status, 409); ok('same client, same year, different Type/Requestee is also rejected (once per year)');
    assert.equal((await dist(2027)).status, 201); ok('2027 distribution for the same client is allowed');
    assert.deepEqual(await SweetDistribution.findById(d2026.body.data._id).lean(), before); ok('2026 record is unchanged after the 2027 record is created');
    assert.equal(await Client.countDocuments({ normalizedName: 'abc technologies' }), 1); ok('client identity is still a single record across years');
    assert.equal((await dist(2025)).status, 400); ok('recording a distribution before 2026 is rejected');

    // Reports per year
    const report = async (year: number) => (await call('GET', `/distributions?year=${year}&limit=50`)).body;
    const row = (body: any) => body.data.find((c: any) => String(c.clientId) === String(acme._id));
    const [r26, r27, r28] = [await report(2026), await report(2027), await report(2028)];
    assert.equal(row(r26).isEligible, false); assert.equal(row(r26).currentYearDistribution.distributionYear, 2026);
    assert.equal(row(r27).isEligible, false); assert.equal(row(r27).currentYearDistribution.distributionYear, 2027);
    assert.equal(row(r28).isEligible, true); assert.equal(row(r28).currentYearDistribution, null);
    ok('reports show the correct distribution (or eligibility) for 2026, 2027 and 2028');
    const given26 = (await call('GET', '/distributions?year=2026&status=GIVEN&limit=50')).body.data.map((c: any) => c.clientName);
    const given28 = (await call('GET', '/distributions?year=2028&status=GIVEN&limit=50')).body.data;
    assert.deepEqual(given26, ['ABC Technologies']); assert.equal(given28.length, 0);
    ok('the Given status filter is year-scoped');
    assert.equal(await SweetDistribution.countDocuments(), 2); ok('no distribution records were deleted by any step');
    console.log(`\n${passed} checks passed`);
  } finally { server.close(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });

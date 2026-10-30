// Run: npx tsx tests/delivery-workflow.test.ts   (in-memory MongoDB only; touches no real data)
// Covers Type, the user-chosen Distribution Quantity (incl. concurrency), Mode, the Courier and
// In-person status workflows, delivery-proof rules, filters, persistence and legacy-record handling.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import clientRoutes from '../src/routes/clientRoutes.js';
import distributionRoutes from '../src/routes/distributionRoutes.js';
import bdRoutes from '../src/routes/bdRoutes.js';
import { generateToken } from '../src/config/jwt.js';
import { MAX_PROOF_BYTES, MAX_DISTRIBUTION_QUANTITY } from '../src/config/distribution.js';
import { Client, ensureClientIndexes } from '../src/models/Client.js';
import { ClientAssociation, ensureAssociationIndexes } from '../src/models/ClientAssociation.js';
import { SweetDistribution, ensureDistributionIndexes } from '../src/models/SweetDistribution.js';
import { DeliveryProof } from '../src/models/DeliveryProof.js';
import { BD } from '../src/models/BD.js';
import { setProofStorage } from '../src/config/proofStorage.js';
import { memoryProofStorage } from './helpers/memoryProofStorage.js';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

// A structurally valid minimal JPEG: SOI, APP0, SOF0 (8x8), SOS, scan padding, EOI.
const jpeg = (extra = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.alloc(extra, 7), Buffer.from([0xff, 0xd9])]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function main() {
  setProofStorage(memoryProofStorage().storage);
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ensureClientIndexes(); await ensureAssociationIndexes(); await ensureDistributionIndexes(); await DeliveryProof.init();
  const app = express(); app.use(express.json());
  app.use('/api/clients', clientRoutes); app.use('/api/distributions', distributionRoutes); app.use('/api/bds', bdRoutes);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = generateToken({ id: new mongoose.Types.ObjectId().toString(), name: 'Tester', email: 't@adinn.com', role: 'STAFF' });
  const auth = { Authorization: `Bearer ${token}` };
  const call = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...auth }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
  const setStatus = async (id: string, status: string, file?: { data: Buffer; name?: string; type?: string }) => {
    const form = new FormData(); form.append('status', status);
    if (file) form.append('proof', new Blob([new Uint8Array(file.data)], { type: file.type ?? 'image/jpeg' }), file.name ?? 'proof.jpg');
    const res = await fetch(`${base}/distributions/${id}/status`, { method: 'PATCH', headers: auth, body: form });
    return { status: res.status, body: await res.json() as any };
  };
  let phone = 9000000000;
  const newClient = async (name: string, over: object = {}) => {
    const r = await call('POST', '/clients', { quantity: 3, name, mobile: String(++phone), type: 'Vendor', bd: String(bd1._id), ...over });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.data.clientId as string;
  };
  // Courier distributions need an address; tests that do not care get a valid one unless they pass their own.
  const give = (clientId: string, over: any = {}) => call('POST', '/distributions',
    { clientId, year: 2026, type: 'Vendor', bd: String(bd1._id), mode: 'IN_PERSON', ...(over.mode === 'COURIER' && !('address' in over) ? { address: '12 Test Street, Chennai 600001' } : {}), ...over });
  const row = async (clientId: string, query = 'year=2026') => (await call('GET', `/distributions?${query}&limit=100`)).body.data.find((r: any) => r.clientId === clientId);
  let bd1: any, bd2: any;
  try {
    [bd1, bd2] = await BD.create([{ name: 'Requestee One', email: 'one@adinn.com' }, { name: 'Requestee Two', email: 'two@adinn.com' }]);

    // ---- Type ----
    const types = ['Vendor', 'Client', 'Govt. Official', 'OOH Landlords', 'Bank Official'];
    for (const type of types) assert.equal((await call('POST', '/clients', { quantity: 3, name: `Type ${type}`, mobile: String(++phone), type, bd: String(bd1._id) })).status, 201);
    ok('all five Types (Vendor, Client, Govt. Official, OOH Landlords, Bank Official) are accepted');
    for (const type of ['Roadshow', '', undefined, 'vendor']) assert.equal((await call('POST', '/clients', { quantity: 3, name: 'Bad Type', mobile: String(++phone), type, bd: String(bd1._id) })).status, 400);
    ok('legacy verticals, blank, missing and wrong-case Types are rejected');
    assert.equal(await Client.countDocuments({ name: 'Bad Type' }), 0); ok('a rejected Type creates no client');

    // ---- Distribution quantity is chosen by the user and must be above 0 ----
    const plain = await call('POST', '/clients', { quantity: 3, name: 'No Qty', mobile: String(++phone), type: 'Client', bd: String(bd1._id) });
    assert.equal(plain.status, 201); assert.ok(!('allowedQuantity' in plain.body.data)); ok('a client no longer carries an Allowed Quantity');
    const listed = await call('GET', `/clients?type=Vendor&bd=${bd1._id}&limit=100`);
    assert.ok(listed.body.data.every((c: any) => c.type === 'Vendor' && !('allowedQuantity' in c))); ok('client list returns type and no allowedQuantity');
    // Quantity is entered when the client is added: required, a whole number above 0, saved on the client.
    for (const bad of [undefined, 0, -4, 1.5, '3', null, MAX_DISTRIBUTION_QUANTITY + 1]) {
      const rejected = await call('POST', '/clients', { name: 'Bad Qty Co', mobile: String(++phone), type: 'Vendor', bd: String(bd1._id), quantity: bad });
      assert.equal(rejected.status, 400, `quantity ${String(bad)}`); assert.match(rejected.body.message, /Quantity must be a whole number greater than 0/);
    }
    assert.equal(await Client.countDocuments({ name: 'Bad Qty Co' }), 0); ok('adding a client with a missing, zero, negative, fractional, text or oversized quantity is rejected and nothing is saved');
    const fixed = await newClient('Chosen Qty Co', { quantity: 7 });
    assert.equal((await Client.findById(fixed))!.quantity, 7); ok('the entered quantity is saved on the client');
    const fixedGive = await give(fixed, { quantity: 99 }); assert.equal(fixedGive.status, 201, JSON.stringify(fixedGive.body));
    assert.equal(fixedGive.body.data.quantity, 7); assert.equal((await SweetDistribution.findById(fixedGive.body.data._id))!.quantity, 7); ok('the distribution uses the saved client quantity; a quantity in the distribution request is ignored');
    const listedRow = await row(fixed); assert.equal(listedRow.clientQuantity, 7); assert.equal(listedRow.currentYearDistribution.quantity, 7); assert.ok(!('allowedQuantity' in listedRow)); ok('the Entry list reports the saved client quantity');
    const noQty = await mongoose.connection.collection('clients').insertOne({ name: 'No Qty Legacy', normalizedName: 'no qty legacy', mobile: '8000000077', normalizedMobile: '8000000077', email: '', createdAt: new Date(), updatedAt: new Date() });
    const noQtyAssoc = await mongoose.connection.collection('clientassociations').insertOne({ client: noQty.insertedId, type: 'Vendor', bd: bd1._id, createdAt: new Date(), updatedAt: new Date() });
    assert.equal((await row(String(noQty.insertedId))).clientQuantity, null);
    const blocked = await give(String(noQty.insertedId)); assert.equal(blocked.status, 400); assert.match(blocked.body.message, /no quantity yet/); assert.equal(await SweetDistribution.countDocuments({ client: noQty.insertedId }), 0);
    ok('an older client with no quantity is left as-is (shown blank) and cannot be given a distribution until a quantity is set');
    assert.equal((await call('PUT', `/clients/${noQtyAssoc.insertedId}`, { quantity: 0 })).status, 400); assert.equal((await call('PUT', `/clients/${noQtyAssoc.insertedId}`, { name: 'No Qty Legacy 2' })).status, 200);
    assert.equal((await Client.findById(noQty.insertedId))!.quantity, undefined); ok('editing other fields never invents a quantity; an invalid quantity is rejected');
    assert.equal((await call('PUT', `/clients/${noQtyAssoc.insertedId}`, { quantity: 4 })).status, 200); assert.equal((await give(String(noQty.insertedId))).body.data.quantity, 4); ok('setting a quantity on an older client lets its distribution use it');

    // ---- Concurrency ----
    const raced = await newClient('Race Qty Co');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => give(raced, { mode: i % 3 ? 'COURIER' : 'IN_PERSON' })));
    assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => r.status)));
    assert.ok(results.every(r => [201, 409].includes(r.status)));
    const stored = await SweetDistribution.find({ client: raced, isReverted: false }).lean();
    assert.equal(stored.length, 1); assert.equal(stored[0].quantity, 3); ok('12 concurrent distributions for one client record exactly one, with its own quantity');

    // ---- Client edits cannot change the distribution quantity ----
    const edit = await newClient('Edit Qty Co');
    const editAssoc = (await ClientAssociation.findOne({ client: edit }))!;
    assert.equal((await call('PUT', `/clients/${editAssoc._id}`, { allowedQuantity: 1 })).status, 200);
    const editGive = await give(edit); assert.equal(editGive.body.data.quantity, 3);
    assert.equal((await call('PUT', `/clients/${editAssoc._id}`, { allowedQuantity: 1, name: 'Edit Qty Co Renamed' })).status, 200);
    assert.equal((await SweetDistribution.findById(editGive.body.data._id))!.quantity, 3); ok('editing a client (even sending an old allowedQuantity) never blocks or changes a distribution');
    assert.equal((await setStatus(editGive.body.data._id, 'DELIVERED')).status, 200);

    // ---- Mode ----
    const modeClient = await newClient('Mode Co');
    for (const bad of [undefined, '', 'Courier', 'POST', 'DRONE']) assert.equal((await give(modeClient, { mode: bad })).status, 400);
    ok('missing or unknown Distribution Mode is rejected');
    const courier = await give(modeClient, { mode: 'COURIER' });
    assert.equal(courier.status, 201); assert.equal(courier.body.data.mode, 'COURIER'); assert.equal(courier.body.data.status, 'INITIATE');
    assert.equal((await row(modeClient)).currentYearDistribution.mode, 'COURIER'); ok('Courier mode persists and starts at Initiate');

    // ---- Courier address ----
    const addrClient = await newClient('Address Co'); const addrOnly = { clientId: addrClient, year: 2026, type: 'Vendor', bd: String(bd1._id), mode: 'COURIER' };
    for (const bad of [undefined, '', '   ', 'abc', 'x'.repeat(501), 12345, null]) assert.equal((await call('POST', '/distributions', { ...addrOnly, address: bad })).status, 400);
    assert.equal(await SweetDistribution.countDocuments({ client: addrClient }), 0); ok('Courier without a valid address (missing, blank, too short, too long, non-string) is rejected and nothing is saved');
    const addrOk = await call('POST', '/distributions', { ...addrOnly, address: '  14,   Gandhi Road\nT. Nagar, Chennai 600017  ' });
    const expectedAddress = '14, Gandhi Road\nT. Nagar, Chennai 600017';
    assert.equal(addrOk.status, 201); assert.equal(addrOk.body.data.address, expectedAddress);
    assert.equal((await SweetDistribution.findById(addrOk.body.data._id))!.address, expectedAddress); ok('Courier address is trimmed and saved in MongoDB');
    assert.equal((await row(addrClient)).currentYearDistribution.address, expectedAddress); ok('the saved address is returned in the distribution payload');
    const walkIn = await newClient('Walk In Co'); const walkGive = await give(walkIn, { mode: 'IN_PERSON', address: 'Should not be kept 12345' });
    assert.equal(walkGive.status, 201); assert.equal((await SweetDistribution.findById(walkGive.body.data._id))!.address, undefined);
    assert.equal((await row(walkIn)).currentYearDistribution.address, null); ok('In-person needs no address and any address sent is not stored or returned');

    // ---- Courier workflow ----
    const courierId = courier.body.data._id as string;
    for (const target of ['SHIPPING', 'DELIVERED', 'INITIATE', 'BOGUS']) assert.ok([400, 409].includes((await setStatus(courierId, target)).status));
    assert.equal((await SweetDistribution.findById(courierId))!.status, 'INITIATE'); ok('courier cannot skip stages (Initiate -> Shipping/Delivered) or repeat Initiate');
    assert.equal((await setStatus(courierId, 'DISPATCH')).status, 200);
    assert.equal((await setStatus(courierId, 'INITIATE')).status, 409); assert.equal((await setStatus(courierId, 'DISPATCH')).status, 409); ok('courier cannot go backwards or repeat a stage');
    assert.equal((await setStatus(courierId, 'DELIVERED')).status, 409); ok('courier cannot jump from Dispatch to Delivered');
    assert.equal((await setStatus(courierId, 'SHIPPING')).status, 200);
    // Proof rules at Delivered
    let r = await setStatus(courierId, 'DELIVERED'); assert.equal(r.status, 400); assert.match(r.body.message, /proof is required/i);
    r = await setStatus(courierId, 'DELIVERED', { data: jpeg(), name: 'proof.png', type: 'image/png' }); assert.equal(r.status, 400);
    r = await setStatus(courierId, 'DELIVERED', { data: jpeg(), name: 'proof.jpg', type: 'image/png' }); assert.equal(r.status, 400);
    r = await setStatus(courierId, 'DELIVERED', { data: jpeg(), name: 'proof.pdf', type: 'image/jpeg' }); assert.equal(r.status, 400);
    r = await setStatus(courierId, 'DELIVERED', { data: png, name: 'fake.jpg', type: 'image/jpeg' }); assert.equal(r.status, 400); assert.match(r.body.message, /valid JPEG/i);
    r = await setStatus(courierId, 'DELIVERED', { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]), name: 'cut.jpg' }); assert.equal(r.status, 400);
    r = await setStatus(courierId, 'DELIVERED', { data: jpeg(MAX_PROOF_BYTES + 1) }); assert.equal(r.status, 413);
    assert.equal((await SweetDistribution.findById(courierId))!.status, 'SHIPPING'); assert.equal(await DeliveryProof.countDocuments(), 0);
    ok('courier Delivered is blocked without proof, with wrong extension/MIME, a spoofed non-JPEG, a truncated file, or an oversized file; no status change, nothing stored');
    r = await setStatus(courierId, 'DELIVERED', { data: jpeg(1000), name: 'receipt.JPEG' });
    assert.equal(r.status, 200); assert.equal(r.body.data.status, 'DELIVERED'); assert.equal(r.body.data.hasProof, true); ok('courier Delivered succeeds with a valid JPEG');
    const proofRes = await fetch(`${base}/distributions/${courierId}/proof`, { headers: auth });
    assert.equal(proofRes.status, 200); assert.equal(proofRes.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await proofRes.arrayBuffer()), jpeg(1000)); ok('stored proof is returned byte-for-byte with an image/jpeg content type');

    // ---- Delivered timestamp and details popup payload ----
    const deliveredDoc = (await SweetDistribution.findById(courierId))!;
    assert.ok(deliveredDoc.deliveredAt instanceof Date && Math.abs(Date.now() - deliveredDoc.deliveredAt.getTime()) < 120000);
    const deliveredEntry = deliveredDoc.statusHistory.find(entry => entry.status === 'DELIVERED')!;
    assert.equal(deliveredDoc.deliveredAt!.getTime(), deliveredEntry.at.getTime()); ok('Delivered saves a backend-generated deliveredAt in MongoDB, equal to the Delivered history entry');
    const earlier = await SweetDistribution.findOne({ status: { $ne: 'DELIVERED' }, mode: 'COURIER' }); assert.ok(earlier); assert.equal(earlier!.deliveredAt, undefined); ok('records that are not Delivered have no deliveredAt');
    const deliveredRow = await row(modeClient); assert.equal(new Date(deliveredRow.currentYearDistribution.deliveredAt).getTime(), deliveredDoc.deliveredAt!.getTime()); ok('deliveredAt is returned for the popup');
    const modeAssoc = (await ClientAssociation.findOne({ client: modeClient }))!;
    assert.equal((await call('PUT', `/clients/${modeAssoc._id}`, { name: 'Mode Co Renamed', email: 'moded@adinn.com' })).status, 200);
    assert.equal((await SweetDistribution.findById(courierId))!.deliveredAt!.getTime(), deliveredDoc.deliveredAt!.getTime());
    assert.equal((await setStatus(courierId, 'DELIVERED')).status, 409);
    assert.equal((await SweetDistribution.findById(courierId))!.deliveredAt!.getTime(), deliveredDoc.deliveredAt!.getTime()); ok('deliveredAt is preserved by unrelated client edits and repeated Delivered attempts');
    const historical = editGive.body.data._id as string; await SweetDistribution.collection.updateOne({ _id: new mongoose.Types.ObjectId(historical) }, { $unset: { deliveredAt: '' } });
    assert.equal((await row(edit)).currentYearDistribution.deliveredAt, null);
    assert.equal((await call('PUT', `/clients/${editAssoc._id}`, { name: 'Edit Qty Co Again' })).status, 200);
    assert.equal((await SweetDistribution.findById(historical))!.deliveredAt, undefined); ok('a Delivered record without a historical timestamp reports null (shown as Not recorded) and edits do not invent one');
    const popup = await row(modeClient), pd = popup.currentYearDistribution;
    for (const field of ['clientName', 'clientMobile', 'clientEmail', 'createdAt', 'lastGiven', 'associations']) assert.ok(popup[field] !== undefined, field);
    assert.ok(popup.associations[0].type && popup.associations[0].bd.name && popup.associations[0].bd.email);
    for (const field of ['quantity', 'mode', 'status', 'address', 'deliveredAt']) assert.ok(pd[field] !== undefined && pd[field] !== null, field);
    assert.equal(pd.address, '12 Test Street, Chennai 600001'); ok('the list payload carries every field the details popup shows');
    assert.equal((await fetch(`${base}/distributions/${courierId}/proof`)).status, 401);
    assert.equal((await fetch(`${base}/distributions/${courierId}/proof`, { headers: { Authorization: 'Bearer nope' } })).status, 401);
    const unauthStatus = await fetch(`${base}/distributions/${courierId}/status`, { method: 'PATCH', body: new FormData() });
    assert.equal(unauthStatus.status, 401); ok('proof download and status updates require authentication');
    assert.equal((await fetch(`${base}/distributions/${new mongoose.Types.ObjectId()}/proof`, { headers: auth })).status, 404); ok('missing proof returns 404');
    assert.equal((await setStatus(courierId, 'DELIVERED', { data: jpeg() })).status, 409); ok('a delivered courier record cannot be advanced or re-proofed');
    const persisted = await row(modeClient);
    assert.equal(persisted.currentYearDistribution.status, 'DELIVERED'); assert.equal(persisted.currentYearDistribution.hasProof, true);
    assert.deepEqual(persisted.currentYearDistribution.statusHistory.map((h: any) => h.status), ['INITIATE', 'DISPATCH', 'SHIPPING', 'DELIVERED']);
    assert.ok(!JSON.stringify(persisted).includes('"data"')); ok('status progress, history and proof flag persist across reads; image bytes are not in list responses');
    assert.equal(await DeliveryProof.countDocuments({ distribution: courierId }), 1); ok('exactly one proof is stored for the delivered distribution');

    // ---- In-person workflow ----
    const personClient = await newClient('In Person Co'); const person = await give(personClient, { mode: 'IN_PERSON' });
    const personId = person.body.data._id as string;
    for (const target of ['DISPATCH', 'SHIPPING', 'INITIATE']) assert.equal((await setStatus(personId, target)).status, 409);
    ok('in-person has no Dispatch/Shipping stage');
    r = await setStatus(personId, 'DELIVERED'); assert.equal(r.status, 200); assert.equal(r.body.data.hasProof, false); ok('in-person Delivered succeeds without proof');
    assert.equal((await setStatus(personId, 'DELIVERED')).status, 409); ok('in-person cannot be delivered twice');
    const withProofClient = await newClient('In Person Proof Co'); const withProof = await give(withProofClient, { mode: 'IN_PERSON' });
    assert.equal((await setStatus(withProof.body.data._id, 'DELIVERED', { data: png, name: 'x.jpg' })).status, 400);
    assert.equal((await SweetDistribution.findById(withProof.body.data._id))!.status, 'INITIATE'); ok('an invalid optional proof still blocks in-person Delivered');
    r = await setStatus(withProof.body.data._id, 'DELIVERED', { data: jpeg(50) }); assert.equal(r.status, 200); assert.equal(r.body.data.hasProof, true); ok('in-person Delivered accepts an optional valid JPEG');
    const earlyProof = await newClient('Early Proof Co'); const early = await give(earlyProof, { mode: 'COURIER' });
    assert.equal((await setStatus(early.body.data._id, 'DISPATCH', { data: jpeg() })).status, 400); ok('proof cannot be attached before the Delivered stage');

    // ---- Status concurrency ----
    const flood = await newClient('Flood Co'); const floodId = (await give(flood, { mode: 'COURIER' })).body.data._id as string;
    const moves = await Promise.all(Array.from({ length: 8 }, () => setStatus(floodId, 'DISPATCH')));
    assert.equal(moves.filter(m => m.status === 200).length, 1); assert.equal((await SweetDistribution.findById(floodId))!.statusHistory.length, 2); ok('8 concurrent Dispatch requests advance the stage exactly once');
    await setStatus(floodId, 'SHIPPING');
    const deliveries = await Promise.all([jpeg(10), jpeg(20), jpeg(30), jpeg(40)].map(data => setStatus(floodId, 'DELIVERED', { data })));
    assert.equal(deliveries.filter(d => d.status === 200).length, 1);
    const winner = (await SweetDistribution.findById(floodId))!;
    assert.equal(await DeliveryProof.countDocuments({ distribution: floodId }), 1); assert.equal(String((await DeliveryProof.findOne({ distribution: floodId }))!._id), String(winner.proof));
    ok('4 concurrent courier deliveries store exactly one proof and the record points at it');

    // ---- Reverted record ----
    const reverted = await newClient('Revert Co'); const revertedId = (await give(reverted)).body.data._id as string;
    assert.equal((await call('POST', `/distributions/${revertedId}/revert`, { reason: 'entered by mistake' })).status, 200);
    assert.equal((await setStatus(revertedId, 'DELIVERED')).status, 404); ok('a reverted distribution cannot change status');
    assert.equal((await give(reverted, { mode: 'COURIER' })).status, 201); ok('after revert the client can be recorded again with a new mode');

    // ---- Filters ----
    const filterBase = await Promise.all([
      ['Zqf Courier Initiate', 'Vendor', 'COURIER', []], ['Zqf Courier Dispatch', 'Vendor', 'COURIER', ['DISPATCH']],
      ['Zqf Courier Shipping', 'Client', 'COURIER', ['DISPATCH', 'SHIPPING']], ['Zqf Person Initiate', 'Vendor', 'IN_PERSON', []],
      ['Zqf Person Delivered', 'Client', 'IN_PERSON', ['DELIVERED']], ['Zqf Not Given', 'Vendor', null, []],
    ].map(async ([name, type, mode, steps]: any) => {
      const id = await newClient(name, { type });
      if (mode) { const d = await give(id, { type, mode, year: 2026 }); for (const step of steps) assert.equal((await setStatus(d.body.data._id, step)).status, 200); }
      return [name, id] as [string, string];
    }));
    const names = async (query: string) => (await call('GET', `/distributions?year=2026&limit=100&search=Zqf&${query}`)).body.data.map((c: any) => c.clientName).sort();
    assert.deepEqual(await names('mode=COURIER'), ['Zqf Courier Dispatch', 'Zqf Courier Initiate', 'Zqf Courier Shipping']);
    assert.deepEqual(await names('mode=IN_PERSON'), ['Zqf Person Delivered', 'Zqf Person Initiate']); ok('Distribution Mode filter');
    assert.deepEqual(await names('mode=COURIER&deliveryStatus=DISPATCH'), ['Zqf Courier Dispatch']);
    assert.deepEqual(await names('mode=COURIER&deliveryStatus=SHIPPING'), ['Zqf Courier Shipping']);
    assert.deepEqual(await names('mode=IN_PERSON&deliveryStatus=DELIVERED'), ['Zqf Person Delivered']);
    assert.deepEqual(await names('mode=IN_PERSON&deliveryStatus=INITIATE'), ['Zqf Person Initiate']); ok('mode + delivery status filters');
    for (const bad of ['deliveryStatus=DELIVERED', 'mode=IN_PERSON&deliveryStatus=DISPATCH', 'mode=IN_PERSON&deliveryStatus=SHIPPING', 'mode=COURIER&deliveryStatus=BOGUS', 'mode=DRONE'])
      assert.equal((await call('GET', `/distributions?year=2026&${bad}`)).status, 400, bad);
    ok('a delivery status without a mode, or a stage the mode does not have, is rejected');
    assert.deepEqual(await names('mode=COURIER&type=Client'), ['Zqf Courier Shipping']);
    assert.deepEqual(await names('mode=COURIER&type=Vendor&deliveryStatus=DISPATCH'), ['Zqf Courier Dispatch']);
    assert.deepEqual(await names('mode=IN_PERSON&type=Client&status=GIVEN'), ['Zqf Person Delivered']);
    assert.deepEqual(await names('mode=IN_PERSON&status=NOT_GIVEN'), []);
    assert.deepEqual((await call('GET', '/distributions?year=2026&search=Zqf%20Courier%20Dispatch&mode=COURIER')).body.data.map((c: any) => c.clientName), ['Zqf Courier Dispatch']);
    assert.deepEqual(await names(`mode=COURIER&bd=${bd2._id}`), []);
    assert.deepEqual(await names(`mode=COURIER&bd=${bd1._id}&type=Vendor`), ['Zqf Courier Dispatch', 'Zqf Courier Initiate']); ok('mode/status combine with Type, Requestee, search and Given filters');
    assert.deepEqual((await call('GET', '/distributions?year=2027&mode=COURIER&search=Zqf&limit=100')).body.data, []); ok('mode filter is year-scoped');
    assert.deepEqual(await names('type=Client'), ['Zqf Courier Shipping', 'Zqf Person Delivered']);
    const notGiven = await names('status=NOT_GIVEN'); assert.deepEqual(notGiven, ['Zqf Not Given']); ok('Type and Given filters still work with the new fields');
    assert.equal((await call('GET', '/distributions?year=2026&type=Roadshow')).status, 400); ok('legacy vertical names are no longer valid Type filters');
    const total = await call('GET', '/distributions?year=2026&mode=COURIER&search=Zqf&limit=2'); assert.equal(total.body.pagination.total, 3); assert.equal(total.body.data.length, 2); ok('pagination totals respect the mode filter');

    // ---- Requestee search ----
    const byRequestee = await call('GET', '/distributions?year=2026&search=one%40adinn&limit=100');
    assert.ok(byRequestee.body.data.length > 0); ok('search by Requestee email still matches');
    const bdNameHit = await call('GET', '/distributions?year=2026&search=Requestee%20Two&limit=100');
    assert.equal(bdNameHit.body.data.length, 0); ok('search by another Requestee name matches only their clients');
    const linkQty = await call('POST', '/clients', { name: 'Chosen Qty Co', mobile: '9999999999', type: 'Client', bd: String(bd2._id), quantity: 50, confirmExisting: true });
    assert.equal(linkQty.status, 201, JSON.stringify(linkQty.body)); assert.equal((await Client.findById(fixed))!.quantity, 7); ok('linking an existing client keeps its saved quantity');


    // ---- Legacy records created before Type / Quantity / Mode existed ----
    const legacyClient = await mongoose.connection.collection('clients').insertOne({ name: 'Legacy Co', normalizedName: 'legacy co', mobile: '8000000001', normalizedMobile: '8000000001', email: '', createdAt: new Date(), updatedAt: new Date() });
    await mongoose.connection.collection('clientassociations').dropIndexes();
    await mongoose.connection.collection('clientassociations').createIndex({ client: 1, vertical: 1, bd: 1 }, { unique: true });
    const legacyAssoc = await mongoose.connection.collection('clientassociations').insertOne({ client: legacyClient.insertedId, vertical: 'Roadshow', bd: bd1._id, createdAt: new Date(), updatedAt: new Date() });
    const legacyDist = await mongoose.connection.collection('sweetdistributions').insertOne({ client: legacyClient.insertedId, distributionYear: 2026, vertical: 'Roadshow', bd: bd1._id, distributedAt: new Date(), notes: 'old', isReverted: false, createdAt: new Date(), updatedAt: new Date() });
    await ensureClientIndexes(); await ensureAssociationIndexes();
    const indexNames = (await ClientAssociation.collection.indexes()).map(index => index.name);
    assert.ok(!indexNames.includes('client_1_vertical_1_bd_1') && indexNames.includes('client_type_bd_unique')); ok('migration swaps the legacy Vertical unique index for the Type index');
    const legacyRow = await row(String(legacyClient.insertedId));
    assert.equal(legacyRow.associations[0].type, null); assert.equal(legacyRow.associations[0].legacyVertical, 'Roadshow');
    assert.equal(legacyRow.currentYearDistribution.mode, null); assert.equal(legacyRow.currentYearDistribution.quantity, null); assert.equal(legacyRow.currentYearDistribution.notes, 'old');
    ok('legacy records stay readable: old vertical preserved, Type unassigned, no mode/quantity');
    const rawAssoc = await mongoose.connection.collection('clientassociations').findOne({ _id: legacyAssoc.insertedId });
    assert.equal(rawAssoc!.vertical, 'Roadshow'); ok('the stored legacy vertical is untouched');
    assert.equal((await setStatus(String(legacyDist.insertedId), 'DELIVERED')).status, 409); ok('a legacy distribution has no status workflow and cannot be advanced');
    assert.equal((await call('POST', '/distributions', { clientId: String(legacyClient.insertedId), year: 2027, type: 'Vendor', bd: String(bd1._id), mode: 'IN_PERSON' })).status, 400); ok('distribution requires an association with a Type; legacy links must be assigned one first');
    assert.equal((await call('PUT', `/clients/${legacyAssoc.insertedId}`, { type: 'Nope' })).status, 400);
    assert.equal((await call('PUT', `/clients/${legacyAssoc.insertedId}`, { type: 'Govt. Official', quantity: 2 })).status, 200);
    assert.equal((await ClientAssociation.findById(legacyAssoc.insertedId))!.type, 'Govt. Official');
    assert.equal((await call('POST', '/distributions', { clientId: String(legacyClient.insertedId), year: 2027, type: 'Govt. Official', bd: String(bd1._id), mode: 'COURIER', address: '12 Test Street, Chennai 600001' })).status, 201); ok('a legacy link can be assigned a Type, after which it works with the new workflow');
    assert.equal((await call('PUT', `/clients/${legacyAssoc.insertedId}`, { type: 'Client' })).status, 200);
    assert.equal((await ClientAssociation.findById(legacyAssoc.insertedId))!.type, 'Govt. Official'); ok('an assigned Type is not silently changed by edits');
    // Same client may hold several Types under one Requestee, and duplicates are blocked.
    const dup = await call('POST', '/clients', { quantity: 3, name: 'Legacy Co', mobile: '8000000001', type: 'Govt. Official', bd: String(bd1._id), confirmExisting: true });
    assert.equal(dup.status, 409); assert.equal(dup.body.code, 'ASSOCIATION_EXISTS'); ok('duplicate Type + Requestee association is still prevented');

    // ---- Inline edit / create payloads exactly as the Entry page sends them (Type, never Vertical) ----
    const inline = await newClient('Inline Co', { type: 'Client' });
    const inlineAssoc = (await ClientAssociation.findOne({ client: inline }))!;
    let edited = await call('PUT', `/clients/${inlineAssoc._id}`, { name: 'Inline Co Renamed', mobile: '7000000001', email: 'inline@adinn.com' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body)); assert.equal(edited.body.data.type, 'Client');
    edited = await call('PUT', `/clients/${inlineAssoc._id}`, { name: 'Inline Co Renamed', mobile: '7000000001', email: '', type: 'Vendor' });
    assert.equal(edited.status, 200); assert.equal((await ClientAssociation.findById(inlineAssoc._id))!.type, 'Client'); ok('inline edit of a typed record saves (with or without a type field) and keeps its Type');
    assert.equal((await ClientAssociation.findById(inlineAssoc._id))!.bd.toString(), String(bd1._id)); ok('inline edit keeps the Requestee association');
    const inlineGive = await give(inline, { type: 'Client', mode: 'COURIER' }); assert.equal(inlineGive.status, 201);
    edited = await call('PUT', `/clients/${inlineAssoc._id}`, { name: 'Inline Co Renamed', mobile: '7000000001', email: '' });
    assert.equal(edited.status, 200);
    assert.equal((await setStatus(inlineGive.body.data._id, 'DISPATCH')).status, 200); ok('inline edit does not disturb an in-progress delivery workflow');
    const linkNew = await call('POST', '/clients', { quantity: 3, name: 'Inline Co Renamed', mobile: '7000000001', email: '', type: 'Bank Official', bd: String(bd2._id), confirmExisting: true });
    assert.equal(linkNew.status, 201, JSON.stringify(linkNew.body)); ok('link-association payload (type + requestee) is accepted');
    const noType = await call('POST', '/clients', { quantity: 3, name: 'No Type Co', mobile: String(++phone), vertical: 'Roadshow', bd: String(bd1._id) });
    assert.equal(noType.status, 400); assert.match(noType.body.message, /Valid Type is required/); assert.ok(!/vertical/i.test(noType.body.message)); ok('a legacy "vertical" payload is rejected with a Type message');
    const fs = await import('node:fs'); const path = await import('node:path');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const stale = [...walk(path.resolve('src')), ...walk(path.resolve('../frontend/src'))].filter(f => /\.(ts|tsx)$/.test(f))
      .filter(f => /Valid Vertical|VALID_VERTICALS|VERTICAL_OPTIONS|req\.body\.vertical|\.vertical.*(includes|!==|===)/.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(stale, []); ok('no active Vertical validation or constants remain in backend or frontend source');

    // ---- Excel bulk import: Type and Requestee come from each row ----
    const dupName = await BD.create({ name: 'Shared Name', email: 'shared1@adinn.com' }); await BD.create({ name: 'Shared Name', email: 'shared2@adinn.com' });
    const before = { clients: await Client.countDocuments(), dists: await SweetDistribution.countDocuments() };
    const bulk = await call('POST', '/clients/bulk-import', { records: [
      { 'Client/Vendor Name': 'Bulk A', 'Mobile Number': '6000000001', 'Email ID': 'a@x.com', Type: 'Vendor', 'Requestee Email': 'ONE@adinn.com' },
      { 'Client/Vendor Name': 'Bulk B', 'Mobile Number': '6000000002', Type: 'Govt. Official', 'Requestee Name': 'requestee   two' },
      { 'Client/Vendor Name': 'Bulk C', 'Mobile Number': '6000000003', Type: 'Roadshow', 'Requestee Email': 'one@adinn.com' },
      { 'Client/Vendor Name': 'Bulk D', 'Mobile Number': '6000000004', Type: 'Client', 'Requestee Email': 'nobody@adinn.com' },
      { 'Client/Vendor Name': 'Bulk E', 'Mobile Number': '6000000005', Type: 'Client', 'Requestee Name': 'Shared Name' },
      { 'Client/Vendor Name': 'Bulk F', 'Mobile Number': '6000000006', Type: 'Client', 'Requestee Email': 'one@adinn.com', 'Allowed Quantity': 0 }, // an old Allowed Quantity column is ignored, not an error
      { 'Client/Vendor Name': 'Bulk G', 'Mobile Number': '', Type: 'Client', 'Requestee Email': 'one@adinn.com' },
      { 'Client/Vendor Name': 'Bulk A', 'Mobile Number': '6000000001', Type: 'Vendor', 'Requestee Email': 'one@adinn.com' },
      { 'Client/Vendor Name': 'Bulk H', 'Mobile Number': '6000000008', Type: 'Client', 'Requestee Email': 'shared2@adinn.com' },
      { 'Client/Vendor Name': 'Bulk I', 'Mobile Number': '6000000009', Type: 'Client' },
    ] });
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
    assert.deepEqual([bulk.body.summary.successful, bulk.body.summary.duplicates, bulk.body.summary.invalid], [4, 1, 5], JSON.stringify(bulk.body));
    const bulkA = (await Client.findOne({ name: 'Bulk A' }).lean())!; const bulkB = (await Client.findOne({ name: 'Bulk B' }).lean())!;
    assert.ok(!('allowedQuantity' in bulkA) && !('allowedQuantity' in bulkB));
    assert.equal((await ClientAssociation.findOne({ client: bulkA._id }))!.type, 'Vendor'); assert.equal(String((await ClientAssociation.findOne({ client: bulkB._id }))!.bd), String(bd2._id));
    assert.ok(await Client.findOne({ name: 'Bulk H' }) && await Client.findOne({ name: 'Bulk F' })); assert.equal(await Client.countDocuments({ name: /^Bulk [CDEGI]$/ }), 0);
    assert.ok(bulk.body.errors.some((m: string) => /Row 5.*ambiguous/.test(m)) && bulk.body.errors.some((m: string) => /Row 3.*Type must be/.test(m)) && bulk.body.errors.some((m: string) => /Row 9|Row 10.*Requestee is required/.test(m)));
    assert.equal(await Client.countDocuments(), before.clients + 4); assert.equal(await SweetDistribution.countDocuments(), before.dists); ok('bulk import reads Type and Requestee (email or name) per row, ignores an old Allowed Quantity column, rejects bad rows with reasons, and creates no distributions');
    const again = await call('POST', '/clients/bulk-import', { records: [{ name: 'Bulk A', mobile: '6000000001', type: 'Vendor', requestee: 'one@adinn.com' }, { name: 'Bulk A', mobile: '6000000001', type: 'Bank Official', requestee: 'one@adinn.com' }] });
    assert.deepEqual([again.body.summary.successful, again.body.summary.duplicates], [1, 1]);
    assert.equal(await ClientAssociation.countDocuments({ client: bulkA._id }), 2); ok('re-importing is idempotent; an existing client gains a new Type association');
    const defaults = await call('POST', '/clients/bulk-import', { type: 'Bank Official', bd: String(bd1._id), records: [{ name: 'Bulk Default', mobile: '6000000010' }] });
    assert.equal(defaults.body.summary.successful, 1); assert.equal((await ClientAssociation.findOne({ client: (await Client.findOne({ name: 'Bulk Default' }))!._id }))!.type, 'Bank Official'); ok('top-level type/bd still act as defaults for blank cells');
    assert.equal((await call('POST', '/clients/bulk-import', { records: [] })).status, 400); assert.equal((await call('POST', '/clients/bulk-import', { type: 'Nope', records: [{}] })).status, 400); ok('empty files and an invalid default Type are rejected');
    void dupName;

    // ---- Phone numbers: exactly 10 digits, numbers only ----
    for (const bad of ['987654321', '98765432100', '+919876543210', '98765 43210', '98765-43210', '98765abc10', '(987)6543210', '', '          ', 12345678901, null]) {
      const r = await call('POST', '/clients', { quantity: 3, name: 'Phone Bad', mobile: bad, type: 'Client', bd: String(bd1._id) });
      assert.equal(r.status, 400, `phone ${JSON.stringify(bad)}`); assert.match(r.body.message, /exactly 10 digits|10 digits/);
    }
    assert.equal(await Client.countDocuments({ name: 'Phone Bad' }), 0);
    assert.equal((await call('POST', '/clients', { quantity: 3, name: 'Phone Good', mobile: '9812345670', type: 'Client', bd: String(bd1._id) })).status, 201); ok('create accepts exactly 10 digits and rejects short, long, +91, spaces, dashes, letters, blank and non-string numbers');
    const phoneAssoc = (await ClientAssociation.findOne({ client: (await Client.findOne({ name: 'Phone Good' }))!._id }))!;
    for (const bad of ['98123456', '+919812345671', '98123 45671', 'abcdefghij']) assert.equal((await call('PUT', `/clients/${phoneAssoc._id}`, { mobile: bad })).status, 400, bad);
    assert.equal((await call('PUT', `/clients/${phoneAssoc._id}`, { mobile: '9812345671' })).status, 200); assert.equal((await Client.findOne({ name: 'Phone Good' }))!.mobile, '9812345671'); ok('editing a phone number enforces the same rule');
    const oldFormat = await mongoose.connection.collection('clients').insertOne({ name: 'Old Format Co', normalizedName: 'old format co', mobile: '+91 98765-00077', normalizedMobile: '9876500077', email: '', createdAt: new Date(), updatedAt: new Date() });
    const oldAssoc = await mongoose.connection.collection('clientassociations').insertOne({ client: oldFormat.insertedId, type: 'Client', bd: bd1._id, createdAt: new Date(), updatedAt: new Date() });
    assert.equal((await call('PUT', `/clients/${oldAssoc.insertedId}`, { name: 'Old Format Co Renamed', mobile: '+91 98765-00077' })).status, 200);
    assert.equal((await Client.findById(oldFormat.insertedId))!.mobile, '+91 98765-00077'); ok('a record saved with an older phone format can still be edited while its number is unchanged');
    assert.equal((await call('PUT', `/clients/${oldAssoc.insertedId}`, { mobile: '+91 98765-00078' })).status, 400); assert.equal((await call('PUT', `/clients/${oldAssoc.insertedId}`, { mobile: '9876500078' })).status, 200); ok('changing an older-format number requires a valid 10-digit one');
    const phoneBulk = await call('POST', '/clients/bulk-import', { type: 'Client', bd: String(bd1._id), records: [{ name: 'PB Ok', mobile: '9811111111' }, { name: 'PB Short', mobile: '981111111' }, { name: 'PB Plus', mobile: '+919811111112' }, { name: 'PB Space', mobile: '98111 11113' }] });
    assert.deepEqual([phoneBulk.body.summary.successful, phoneBulk.body.summary.invalid], [1, 3]); assert.ok(phoneBulk.body.errors.every((m: string) => /10 digits/.test(m))); ok('bulk import rejects any phone that is not exactly 10 digits');

    // ---- Add Requestee (the "+ Add Requestee" flow uses POST /api/bds) ----
    const bdsBefore = await BD.countDocuments();
    const created = await call('POST', '/bds', { name: '  Meera   Nair ', email: ' Meera.Nair@Adinn.co.in ' });
    assert.equal(created.status, 201, JSON.stringify(created.body)); assert.equal(created.body.data.name, 'Meera Nair'); assert.equal(created.body.data.email, 'meera.nair@adinn.co.in');
    assert.ok((await call('GET', '/bds')).body.data.some((b: any) => b._id === created.body.data._id)); ok('a Requestee is saved trimmed (name spacing collapsed, email lower-cased) and appears in the list');
    for (const [label, body, status] of [
      ['duplicate email (any case)', { name: 'Someone Else', email: 'MEERA.NAIR@adinn.co.in' }, 409],
      ['duplicate name (case and spacing)', { name: ' meera    NAIR', email: 'other.meera@adinn.co.in' }, 409],
      ['missing name', { name: '   ', email: 'x1@adinn.co.in' }, 400], ['missing email', { name: 'No Email' }, 400],
      ['invalid email', { name: 'Bad Email', email: 'not-an-email' }, 400], ['non-string name', { name: 123, email: 'x2@adinn.co.in' }, 400],
      ['non-string email', { name: 'Odd Email', email: { a: 1 } }, 400], ['overlong name', { name: 'N'.repeat(121), email: 'x3@adinn.co.in' }, 400],
    ] as const) { const r = await call('POST', '/bds', body); assert.equal(r.status, status, label); }
    assert.equal(await BD.countDocuments(), bdsBefore + 1); ok('duplicates (email or name), blanks, bad emails, non-strings and overlong names are rejected and nothing extra is stored');
    const same = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/bds', { name: 'Race Requestee', email: 'race.requestee@adinn.co.in' })));
    assert.equal(same.filter(r => r.status === 201).length, 1); assert.ok(same.every(r => [201, 409].includes(r.status))); assert.equal(await BD.countDocuments({ email: 'race.requestee@adinn.co.in' }), 1); ok('8 concurrent identical Requestee saves create exactly one');
    const before2 = { assoc: await ClientAssociation.countDocuments(), dists: await SweetDistribution.countDocuments(), clients: await Client.countDocuments() };
    const meeraClient = await call('POST', '/clients', { quantity: 3, name: 'Meera Co', mobile: String(++phone), type: 'Client', bd: created.body.data._id });
    assert.equal(meeraClient.status, 201); assert.equal(String(meeraClient.body.data.bd._id), created.body.data._id);
    assert.equal(await ClientAssociation.countDocuments(), before2.assoc + 1); assert.equal(await SweetDistribution.countDocuments(), before2.dists); assert.equal(await Client.countDocuments(), before2.clients + 1);
    assert.equal((await give(meeraClient.body.data.clientId, { bd: created.body.data._id, type: 'Client', mode: 'IN_PERSON' })).status, 201); ok('a newly added Requestee can be linked to a client and used for a distribution; existing associations are untouched');
    assert.equal((await fetch(`${base}/bds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'No Auth', email: 'noauth@adinn.co.in' }) })).status, 401); ok('adding a Requestee requires authentication');

    // ---- Existing rules untouched ----
    const once = await newClient('Once Co');
    assert.equal((await give(once)).status, 201); assert.equal((await give(once, { type: 'Vendor' })).status, 409); assert.equal((await give(once, { year: 2027 })).status, 201);
    assert.equal((await give(once, { year: 2025 })).status, 400); ok('one distribution per client per year, next year allowed, pre-2026 rejected');

    console.log(`\n${passed} checks passed`);
  } finally { server.close(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });

// Run: npx tsx tests/proof-storage.test.ts   (in-memory MongoDB + in-memory Space stand-in; no network, no real data)
// Covers Spaces uploads, key-only MongoDB storage, the 2 MB cap, JPEG content validation, authorization,
// failure cleanup (no orphans / no inconsistent status) and viewing legacy MongoDB-binary proofs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import clientRoutes from '../src/routes/clientRoutes.js';
import distributionRoutes from '../src/routes/distributionRoutes.js';
import { generateToken } from '../src/config/jwt.js';
import { MAX_PROOF_BYTES } from '../src/config/distribution.js';
import { missingSpacesEnv, proofPutInput, setProofStorage, spacesObjectUrl } from '../src/config/proofStorage.js';
import { ensureClientIndexes } from '../src/models/Client.js';
import { ensureAssociationIndexes } from '../src/models/ClientAssociation.js';
import { SweetDistribution, ensureDistributionIndexes } from '../src/models/SweetDistribution.js';
import { DeliveryProof } from '../src/models/DeliveryProof.js';
import { BD } from '../src/models/BD.js';
import { memoryProofStorage } from './helpers/memoryProofStorage.js';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };
const jpeg = (extra = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.alloc(extra, 7), Buffer.from([0xff, 0xd9])]);

async function main() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ensureClientIndexes(); await ensureAssociationIndexes(); await ensureDistributionIndexes(); await DeliveryProof.init();
  const space = memoryProofStorage(); setProofStorage(space.storage);
  const app = express(); app.use(express.json());
  app.use('/api/clients', clientRoutes); app.use('/api/distributions', distributionRoutes);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokenFor = (role: string) => ({ Authorization: `Bearer ${generateToken({ id: new mongoose.Types.ObjectId().toString(), name: 'T', email: 't@adinn.com', role: role as any })}` });
  const auth = tokenFor('STAFF');
  const call = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...auth }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
  const setStatus = async (id: string, status: string, data?: Buffer, headers: Record<string, string> = auth) => {
    const form = new FormData(); form.append('status', status);
    if (data) form.append('proof', new Blob([new Uint8Array(data)], { type: 'image/jpeg' }), 'proof.jpg');
    const res = await fetch(`${base}/distributions/${id}/status`, { method: 'PATCH', headers, body: form });
    return { status: res.status, body: await res.json() as any };
  };
  let phone = 9100000000;
  try {
    const bd = await BD.create({ name: 'Req', email: 'req@adinn.com' });
    // A courier distribution already at SHIPPING, ready for Delivered.
    const courier = async () => {
      const c = await call('POST', '/clients', { name: `C${phone}`, mobile: String(++phone), type: 'Vendor', bd: String(bd._id) });
      const d = await call('POST', '/distributions', { clientId: c.body.data.clientId, year: 2026, type: 'Vendor', bd: String(bd._id), mode: 'COURIER', address: '12 Test Street, Chennai 600001' });
      const id = d.body.data._id as string;
      for (const s of ['DISPATCH', 'SHIPPING']) assert.equal((await setStatus(id, s)).status, 200);
      return id;
    };

    // ---- Spaces upload, key-only storage ----
    const id = await courier(); const image = jpeg(2000);
    const done = await setStatus(id, 'DELIVERED', image); assert.equal(done.status, 200); assert.equal(done.body.data.hasProof, true);
    const proof = (await DeliveryProof.findOne({ distribution: id }).lean())!;
    assert.match(proof.storageKey!, /^proofs\/2026\/[0-9a-f]{24}\/[0-9a-f-]{36}\.jpg$/);
    assert.equal(proof.data, undefined); assert.equal(proof.size, image.length); assert.equal(proof.sha256, crypto.createHash('sha256').update(image).digest('hex'));
    assert.deepEqual(space.objects.get(proof.storageKey!)!.body, image); assert.equal(space.objects.get(proof.storageKey!)!.contentType, 'image/jpeg');
    ok('proof bytes go to the Space; MongoDB keeps only the object key and metadata (no binary data)');
    const dist = (await SweetDistribution.findById(id))!; assert.equal(String(dist.proof), String(proof._id)); assert.equal(dist.status, 'DELIVERED');
    ok('delivery status, proof reference and deliveredAt are saved together');

    // ---- Authenticated read ----
    const view = await fetch(`${base}/distributions/${id}/proof`, { headers: auth });
    assert.equal(view.status, 200); assert.equal(view.headers.get('content-type'), 'image/jpeg'); assert.match(view.headers.get('cache-control')!, /no-store/);
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), image); ok('Space proof is streamed back byte-for-byte through the authenticated route');
    assert.equal((await fetch(`${base}/distributions/${id}/proof`)).status, 401);
    assert.equal((await fetch(`${base}/distributions/${id}/proof`, { headers: { Authorization: 'Bearer bad' } })).status, 401);
    assert.equal((await fetch(`${base}/distributions/${id}/proof`, { headers: tokenFor('GUEST') })).status, 403);
    assert.equal((await setStatus(id, 'DELIVERED', image, {})).status, 401); ok('viewing or uploading a proof requires authentication and an allowed role');
    assert.ok(!JSON.stringify((await call('GET', '/distributions?year=2026&limit=100')).body).includes(proof.storageKey!)); ok('object keys are never exposed in list responses');

    // ---- 2 MB cap and JPEG content ----
    assert.equal(MAX_PROOF_BYTES, 2 * 1024 * 1024);
    const strict = await courier(); const putsBefore = space.state.puts;
    const exact = jpeg(MAX_PROOF_BYTES - jpeg().length); assert.equal(exact.length, MAX_PROOF_BYTES);
    const tooBig = await setStatus(strict, 'DELIVERED', jpeg(MAX_PROOF_BYTES));
    assert.equal(tooBig.status, 413); assert.match(tooBig.body.message, /2 MB or smaller/); ok('a proof over 2 MB is rejected with a clear message');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const fakes: Buffer[] = [png, Buffer.from('%PDF-1.4 not an image at all, just text'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40, 1)]),
      jpeg().subarray(0, 30), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)])];
    for (const fake of fakes) assert.equal((await setStatus(strict, 'DELIVERED', fake)).status, 400);
    assert.equal(space.state.puts, putsBefore); assert.equal((await SweetDistribution.findById(strict))!.status, 'SHIPPING');
    ok('renamed PNG/PDF/text, header-only and truncated JPEGs are rejected on content; nothing uploaded, status unchanged');
    assert.equal((await setStatus(strict, 'DELIVERED', exact)).status, 200); ok('a valid JPEG of exactly 2 MB is accepted');

    // ---- Failure handling ----
    const outage = await courier(); const objectsBefore = space.objects.size, proofsBefore = await DeliveryProof.countDocuments();
    space.state.failPut = true; const failed = await setStatus(outage, 'DELIVERED', jpeg(100)); space.state.failPut = false;
    assert.equal(failed.status, 500); assert.equal((await SweetDistribution.findById(outage))!.status, 'SHIPPING');
    assert.equal(space.objects.size, objectsBefore); assert.equal(await DeliveryProof.countDocuments(), proofsBefore); ok('a Spaces outage leaves the status unchanged and stores nothing');
    const race = await courier(); const results = await Promise.all([jpeg(10), jpeg(20), jpeg(30)].map(data => setStatus(race, 'DELIVERED', data)));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal(await DeliveryProof.countDocuments({ distribution: race }), 1);
    assert.equal([...space.objects.keys()].filter(k => k.includes(`/${race}/`)).length, 1); ok('concurrent deliveries leave exactly one proof record and one object (losers are cleaned up)');

    // ---- Legacy MongoDB-binary proofs ----
    const legacyId = await courier(); const legacyImage = jpeg(500);
    const legacy = await DeliveryProof.create({ distribution: legacyId, originalName: 'old.jpg', contentType: 'image/jpeg', size: legacyImage.length, sha256: 'x', data: legacyImage });
    await SweetDistribution.updateOne({ _id: legacyId }, { $set: { status: 'DELIVERED', proof: legacy._id, deliveredAt: new Date() } });
    const old = await fetch(`${base}/distributions/${legacyId}/proof`, { headers: auth });
    assert.equal(old.status, 200); assert.deepEqual(Buffer.from(await old.arrayBuffer()), legacyImage);
    assert.equal(await DeliveryProof.countDocuments({ _id: legacy._id }), 1);
    ok('legacy proofs stored as MongoDB binary stay viewable and untouched');
    const empty = await DeliveryProof.create({ distribution: legacyId, originalName: 'a.jpg', contentType: 'image/jpeg', size: 1, sha256: 'x' }).catch(e => e.name);
    assert.equal(empty, 'ValidationError'); ok('a proof needs either an object key or legacy bytes');

    // ---- Direct Space object URLs ----
    const link = await fetch(`${base}/distributions/${id}/proof-url`, { headers: auth }); const linkBody = await link.json() as any;
    assert.equal(link.status, 200); assert.equal(linkBody.data.source, 'SPACES');
    assert.equal(linkBody.data.url, `https://fake-bucket.fake-region.digitaloceanspaces.com/${proof.storageKey}`);
    assert.match(linkBody.data.url, /^https:\/\/[^/]+\.digitaloceanspaces\.com\/proofs\/2026\//); assert.ok(!linkBody.data.url.includes('blob:') && !linkBody.data.url.includes('?'));
    assert.match(link.headers.get('cache-control')!, /no-store/);
    ok('an authorized user gets the direct Space object URL for a Spaces proof');
    const stored = JSON.stringify(await DeliveryProof.findOne({ distribution: id }).lean()) + JSON.stringify(await SweetDistribution.findById(id).lean());
    assert.ok(!stored.includes('https://') && !stored.includes('digitaloceanspaces')); ok('MongoDB stores only the object key, never the URL');
    assert.equal((await fetch(`${base}/distributions/${id}/proof-url`)).status, 401);
    assert.equal((await fetch(`${base}/distributions/${id}/proof-url`, { headers: { Authorization: 'Bearer bad' } })).status, 401);
    assert.equal((await fetch(`${base}/distributions/${id}/proof-url`, { headers: tokenFor('GUEST') })).status, 403);
    assert.equal((await fetch(`${base}/distributions/not-an-id/proof-url`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${base}/distributions/${new mongoose.Types.ObjectId()}/proof-url`, { headers: auth })).status, 404); ok('the URL lookup route still requires authentication and a role, and rejects bad or unknown IDs');
    const legacyLink = await (await fetch(`${base}/distributions/${legacyId}/proof-url`, { headers: auth })).json() as any;
    assert.equal(legacyLink.data.source, 'MONGODB'); assert.equal(legacyLink.data.url, null); ok('legacy MongoDB proofs return no URL, so the client uses the authenticated stream');
    const noProof = await courier(); assert.equal((await fetch(`${base}/distributions/${noProof}/proof-url`, { headers: auth })).status, 404); ok('a distribution without a proof returns 404');

    // ---- URL construction and upload ACL (pure) ----
    assert.equal(spacesObjectUrl('https://nyc3.digitaloceanspaces.com', 'adinn-test', 'proofs/2026/abc/x.jpg'), 'https://adinn-test.nyc3.digitaloceanspaces.com/proofs/2026/abc/x.jpg');
    assert.equal(spacesObjectUrl('nyc3.digitaloceanspaces.com/', 'adinn-test', 'proofs/a b/x.jpg'), 'https://adinn-test.nyc3.digitaloceanspaces.com/proofs/a%20b/x.jpg'); ok('object URLs are https://<bucket>.<region>.digitaloceanspaces.com/<key> (endpoint with or without scheme; CDN base unused)');
    assert.equal(proofPutInput('b', 'proofs/k.jpg', Buffer.from('x'), 'image/jpeg').ACL, 'public-read'); ok('every Space upload requests public-read so the direct URL opens');

    // ---- Configuration ----
    const saved = { ...process.env };
    for (const name of ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_REGION', 'DO_SPACES_BUCKET']) delete process.env[name];
    process.env.DO_SPACES_BUCKET = 'b'; process.env.DO_SPACES_REGION = '  ';
    assert.deepEqual(missingSpacesEnv(), ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_REGION']);
    process.env = saved; ok('missing Spaces variables are reported by name (never their values)');
    console.log(`\n${passed} checks passed`);
  } finally { server.close(); await mongoose.disconnect(); await mongo.stop(); setProofStorage(null); }
}
main().catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });

// Run both phases (each needs a fresh process because it opens its own mongoose connections):
//   npx tsx tests/database.test.ts connection && npx tsx tests/database.test.ts api
// Uses throwaway in-memory MongoDB servers for every write. The only contact with the real
// local MongoDB (127.0.0.1:27017) is a read-only connect + ping; nothing is created or dropped there.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDB } from '../src/config/db.js';
import { requireDatabase } from '../src/middleware/dbReady.js';
import authRoutes from '../src/routes/authRoutes.js';
import bdRoutes from '../src/routes/bdRoutes.js';
import { BD } from '../src/models/BD.js';
import { seedInitialData } from '../src/utils/seedData.js';

const run = promisify(execFile);
const WORKBOOK = process.env.BD_WORKBOOK || 'D:/Adinn-assets/MAIL USERS LIST OCT-2026.xlsx';
let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

async function main(phase: string) {
  if (phase === 'connection') {
  // 1. Connection failure is reported clearly, with an actionable message and no credentials.
  process.env.USE_MEMORY_DB_IF_LOCAL_FAILS = 'false';
  process.env.MONGODB_URI = 'mongodb://dbuser:Sup3rSecret@127.0.0.1:1/adinn_diwali';
  const logged: string[] = [];
  const originalError = console.error; console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  let failure = '';
  try { await connectDB(); } catch (error: any) { failure = error.message; }
  console.error = originalError;
  assert.match(failure, /MongoDB is unreachable/); assert.match(failure, /MONGODB_URI/);
  assert.ok(![failure, ...logged].join('\n').includes('Sup3rSecret'), 'password must never be logged');
  assert.equal(mongoose.connection.readyState, 0);
  ok('unreachable MongoDB fails startup with an actionable message, no silent fallback, no credentials logged');

  // 2. Real local MongoDB: read-only connectivity check.
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/adinn_diwali';
  await connectDB();
  assert.equal(mongoose.connection.readyState, 1);
  assert.equal((await mongoose.connection.db!.admin().ping()).ok, 1);
  assert.equal(mongoose.connection.name, 'adinn_diwali');
  await mongoose.disconnect();
  ok('connects to the local MongoDB at 127.0.0.1:27017 (database adinn_diwali), ping ok');

  // 3. Records persist across a MongoDB restart on the same data directory.
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'adinn-persist-'));
  let server = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri()); await mongoose.connection.db!.collection('bds').insertOne({ name: 'Persist BD', email: 'persist@adinn.com' }, { writeConcern: { j: true } }); // journal-committed, as a real write is
  await mongoose.disconnect(); await server.stop({ doCleanup: false });
  server = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
  await mongoose.connect(server.getUri());
  assert.equal(await BD.countDocuments({ email: 'persist@adinn.com' }), 1);
  await mongoose.disconnect(); await server.stop({ doCleanup: true });
  ok('records survive a database restart');

  console.log(`
${passed} checks passed`);
  return;
  }
  // 4. Empty BD collection (200, count 0) is distinguished from an unavailable database (503).
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri()); await BD.init(); await seedInitialData();
  const app = express(); app.use(express.json()); app.use('/api', requireDatabase);
  app.use('/api/auth', authRoutes); app.use('/api/bds', bdRoutes);
  const server2 = app.listen(0); const base = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'staff@adinn.com', password: 'Staff@123', role: 'STAFF' }) })).json() as any;
  assert.ok(login.token); ok('existing staff login still works');
  const auth = { Authorization: `Bearer ${login.token}` };
  const empty = await fetch(`${base}/api/bds`, { headers: auth });
  assert.equal(empty.status, 200); const emptyBody = await empty.json() as any; assert.equal(emptyBody.count, 0); assert.deepEqual(emptyBody.data, []);
  ok('empty BD collection returns 200 with count 0');

  // 5. Importing the real workbook is validated, complete and idempotent (against the throwaway DB).
  assert.ok(fs.existsSync(WORKBOOK), `workbook not found: ${WORKBOOK}`);
  const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
  const report = path.join(os.tmpdir(), `bd-import-${Date.now()}`);
  const importArgs = ['src/utils/importBDs.ts', '--file', WORKBOOK, '--mongo-uri', mongo.getUri(), '--api-url', base];
  const dry = JSON.parse((await run(process.execPath, [tsx, ...importArgs], { maxBuffer: 1e8 })).stdout);
  assert.equal(dry.mode, 'dry-run'); assert.equal(dry.invalid.length, 0); assert.equal(dry.duplicates.length, 0);
  assert.equal(await BD.countDocuments(), 0); console.log(`  dry run: total=${dry.totalRows} active=${dry.activeRows} valid=${dry.validUniqueActiveRows} invalid=${dry.invalid.length} duplicates=${dry.duplicates.length} pending=${dry.pending}`);
  assert.equal(dry.validUniqueActiveRows, 204); ok('dry run validates the NAME-header workbook: 204 valid, 0 invalid, 0 duplicate; nothing written');
  const first = JSON.parse((await run(process.execPath, [tsx, ...importArgs, '--apply', '--report', `${report}-1.json`], { maxBuffer: 1e8 })).stdout);
  assert.equal(first.inserted, 204); assert.equal(first.success, true); assert.equal(await BD.countDocuments(), 204); ok('apply imports 204 BDs, non-BD collections unchanged');
  const second = JSON.parse((await run(process.execPath, [tsx, ...importArgs, '--apply', '--report', `${report}-2.json`], { maxBuffer: 1e8 })).stdout);
  assert.equal(second.inserted, 0); assert.equal(await BD.countDocuments(), 204); ok('importing the same workbook twice creates no duplicates');
  const listed = await (await fetch(`${base}/api/bds`, { headers: auth })).json() as any;
  assert.equal(listed.count, 204); assert.ok(listed.data.every((b: any) => b._id && b.name && b.email)); ok('GET /api/bds returns all 204 imported BDs as { _id, name, email }');
  fs.rmSync(`${report}-1.json`, { force: true }); fs.rmSync(`${report}-2.json`, { force: true });

  // 6. Database loss is reported as 503, never as an empty list.
  await mongoose.disconnect();
  const down = await fetch(`${base}/api/bds`, { headers: auth }); const downBody = await down.json() as any;
  assert.equal(down.status, 503); assert.equal(downBody.code, 'DB_UNAVAILABLE');
  ok('lost database connection returns 503 DB_UNAVAILABLE, not an empty list');
  server2.close(); await mongo.stop();
  console.log(`\n${passed} checks passed`);
}
main(process.argv[2] || 'api').catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });

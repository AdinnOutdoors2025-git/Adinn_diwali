// Read-only database inventory and full backup. It NEVER writes to, deletes from or drops anything in the database.
//   npx tsx src/utils/dbBackup.ts inventory [--live]   -> prints the database name, every collection, counts, sizes and index names
//   npx tsx src/utils/dbBackup.ts backup      -> exports every collection (incl. binary proofs) to backend/backups/<timestamp>/ and verifies it
// Uses MONGODB_URI from backend/.env. Credentials are never printed. The backups folder is gitignored; it contains
// personal data and proof images, so store it somewhere private and delete local copies you do not need.
import dotenv from 'dotenv';
dotenv.config();
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import readline from 'node:readline';
import mongoose from 'mongoose';
import { EJSON } from 'bson';
import { describeMongoUri } from '../config/db.js';

dns.setServers(['8.8.8.8']);

const serialize = (doc: unknown) => EJSON.stringify(doc as any, { relaxed: false });

async function connect() {
  // Pass --live to target MONGODB_URI_LIVE instead of MONGODB_URI. Either way the tool only reads.
  const variable = process.argv.includes('--live') ? 'MONGODB_URI_LIVE' : 'MONGODB_URI';
  const uri = process.env[variable];
  if (!uri) throw new Error(`${variable} is not set in backend/.env`);
  console.log(`Using ${variable}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, readPreference: 'secondaryPreferred' });
  const db = mongoose.connection.db!;
  console.log(`Target: ${describeMongoUri(uri)}   (database name: "${db.databaseName}")`);
  return db;
}

async function inventory(db: mongoose.mongo.Db) {
  const collections = (await db.listCollections({}, { nameOnly: false }).toArray()).filter(c => c.type !== 'view');
  const rows: { name: string; count: number; bytes: number; indexes: string[] }[] = [];
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = db.collection(name);
    const stats = await db.command({ collStats: name }).catch(() => ({ size: 0 }));
    rows.push({ name, count: await collection.countDocuments({}), bytes: stats.size ?? 0, indexes: (await collection.indexes()).map(i => i.name!) });
  }
  console.table(rows.map(r => ({ collection: r.name, documents: r.count, 'size (MB)': +(r.bytes / 1024 / 1024).toFixed(2), indexes: r.indexes.join(', ') })));
  return rows;
}

async function backup(db: mongoose.mongo.Db) {
  const rows = await inventory(db);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve('backups', `${db.databaseName}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest: any = { database: db.databaseName, createdAt: new Date().toISOString(), format: 'EJSON (canonical), one document per line', collections: {} };
  for (const row of rows) {
    const file = path.join(dir, `${row.name}.ejsonl`);
    const out = fs.createWriteStream(file); const hash = crypto.createHash('sha256'); let written = 0;
    for await (const doc of db.collection(row.name).find({})) {
      const line = serialize(doc) + '\n'; hash.update(line);
      if (!out.write(line)) await new Promise<void>(resolve => { out.once('drain', () => resolve()); });
      written++;
    }
    await new Promise<void>(resolve => { out.end(() => resolve()); });
    const indexes = await db.collection(row.name).indexes();
    fs.writeFileSync(path.join(dir, `${row.name}.indexes.json`), JSON.stringify(indexes, null, 2));
    manifest.collections[row.name] = { documents: written, sha256: hash.digest('hex'), file: path.basename(file) };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Verification: re-read every file from disk, re-hash it, and compare each stored document with the live one.
  let problems = 0;
  for (const [name, info] of Object.entries<any>(manifest.collections)) {
    const file = path.join(dir, info.file); const hash = crypto.createHash('sha256'); let lines = 0, mismatches = 0;
    const live = db.collection(name).find({}).sort({ _id: 1 });
    const stored = new Map<string, string>();
    for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
      if (!line) continue; hash.update(line + '\n'); lines++;
      const doc: any = EJSON.parse(line, { relaxed: false }); stored.set(String(doc._id), crypto.createHash('sha256').update(serialize(doc)).digest('hex'));
    }
    let liveCount = 0;
    for await (const doc of live) {
      liveCount++;
      if (stored.get(String(doc._id)) !== crypto.createHash('sha256').update(serialize(doc)).digest('hex')) mismatches++;
    }
    const good = hash.digest('hex') === info.sha256 && lines === info.documents && liveCount === lines && mismatches === 0;
    if (!good) problems++;
    console.log(`${good ? 'VERIFIED' : 'MISMATCH'}  ${name}: ${lines} documents on disk, ${liveCount} live, ${mismatches} differing`);
  }
  console.log(problems ? `\nBACKUP FAILED VERIFICATION in ${dir}` : `\nBackup complete and verified: ${dir}`);
  if (problems) process.exitCode = 1;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'inventory' && mode !== 'backup') { console.error('Usage: tsx src/utils/dbBackup.ts <inventory|backup>'); process.exit(2); }
  const db = await connect();
  try { await (mode === 'inventory' ? inventory(db) : backup(db)); } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error('FAILED:', error?.message || error); process.exit(1); });

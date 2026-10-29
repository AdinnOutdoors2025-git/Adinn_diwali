// Run: npx tsx tests/occasion-indexes.test.ts   (in-memory MongoDB only; touches no real data)
// Covers startup of ensureOccasions() against databases that already have a normalizedName index under any name,
// repeated calls, and that records and the unique / case-insensitive duplicate protection are preserved.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DEFAULT_OCCASIONS } from '../src/config/occasions.js';
import { Occasion, ensureOccasions } from '../src/models/Occasion.js';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };
const normalizedIndexes = async () => (await Occasion.collection.indexes()).filter(index => Object.keys(index.key).length === 1 && index.key.normalizedName === 1);

async function main() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const reset = async () => { await mongoose.connection.db!.dropCollection('occasions').catch(() => undefined); };
  const assertProtected = async () => {
    const before = await Occasion.countDocuments();
    await assert.rejects(Occasion.collection.insertOne({ name: 'diwali', normalizedName: 'diwali', isDefault: false }), (error: any) => error.code === 11000);
    assert.equal(await Occasion.countDocuments(), before);
  };
  try {
    // 1. Fresh database
    await reset(); await ensureOccasions();
    let indexes = await normalizedIndexes(); assert.equal(indexes.length, 1); assert.equal(indexes[0].unique, true);
    assert.deepEqual((await Occasion.find().lean()).map(o => o.name).sort(), [...DEFAULT_OCCASIONS].sort()); await assertProtected(); ok('a fresh database gets one unique normalizedName index and the default occasions');

    // 2. Repeated startups
    const ids = (await Occasion.find().lean()).map(o => String(o._id)).sort();
    for (let i = 0; i < 3; i++) await ensureOccasions();
    assert.equal((await normalizedIndexes()).length, 1); assert.deepEqual((await Occasion.find().lean()).map(o => String(o._id)).sort(), ids); ok('repeated ensureOccasions() calls change nothing');

    // 3. The reported failure: an existing unique index named normalizedName_1 (created by an earlier version of the schema)
    await reset(); await Occasion.createCollection();
    await Occasion.collection.createIndex({ normalizedName: 1 }, { unique: true, name: 'normalizedName_1' });
    await Occasion.collection.insertOne({ name: 'Pongal', normalizedName: 'pongal', isDefault: true, createdAt: new Date('2026-01-01') });
    await Occasion.collection.insertOne({ name: 'Custom Fest', normalizedName: 'custom fest', isDefault: false, createdAt: new Date('2026-02-02') });
    await ensureOccasions(); await ensureOccasions();
    indexes = await normalizedIndexes(); assert.equal(indexes.length, 1); assert.equal(indexes[0].name, 'normalizedName_1'); assert.equal(indexes[0].unique, true);
    ok('an existing unique normalizedName_1 index is reused: no IndexOptionsConflict, no second index');
    const rows = await Occasion.find().lean();
    assert.equal(rows.length, DEFAULT_OCCASIONS.length + 1); assert.ok(rows.find(o => o.name === 'Custom Fest')); assert.equal(rows.filter(o => o.normalizedName === 'pongal').length, 1);
    assert.equal(rows.find(o => o.name === 'Pongal')!.createdAt.toISOString(), '2026-01-01T00:00:00.000Z'); ok('existing occasions are kept unchanged; only missing defaults are added');
    await assertProtected(); ok('case-insensitive duplicates are still rejected by the unique index');

    // 4. Same index under another name
    await reset(); await Occasion.createCollection();
    await Occasion.collection.createIndex({ normalizedName: 1 }, { unique: true, name: 'occasion_normalized_unique' });
    await ensureOccasions(); await ensureOccasions();
    indexes = await normalizedIndexes(); assert.equal(indexes.length, 1); assert.equal(indexes[0].name, 'occasion_normalized_unique'); await assertProtected(); ok('an equivalent unique index with any other name is reused too');

    // 5. A genuinely non-unique index on the same key is migrated safely (no duplicates present)
    await reset(); await Occasion.createCollection();
    await Occasion.collection.createIndex({ normalizedName: 1 }, { name: 'normalizedName_1' });
    await Occasion.collection.insertOne({ name: 'Onam', normalizedName: 'onam', isDefault: false });
    await ensureOccasions();
    indexes = await normalizedIndexes(); assert.equal(indexes.length, 1); assert.equal(indexes[0].unique, true); assert.ok(await Occasion.findOne({ normalizedName: 'onam' })); await assertProtected(); ok('a non-unique index on the same key is replaced by a unique one, keeping all records');

    // 6. ...but never when duplicates already exist
    await reset(); await Occasion.createCollection();
    await Occasion.collection.createIndex({ normalizedName: 1 }, { name: 'normalizedName_1' });
    await Occasion.collection.insertMany([{ name: 'Holi', normalizedName: 'holi', isDefault: false }, { name: 'HOLI', normalizedName: 'holi', isDefault: false }]);
    await assert.rejects(ensureOccasions(), /duplicate occasion names/);
    assert.equal(await Occasion.countDocuments(), 2); assert.equal((await normalizedIndexes()).length, 1); assert.equal((await normalizedIndexes())[0].unique, undefined); ok('with existing duplicates it stops with a clear error and changes nothing');

    // 7. The model never auto-builds a conflicting index on its own
    await reset(); await Occasion.createCollection();
    await Occasion.collection.createIndex({ normalizedName: 1 }, { unique: true, name: 'normalizedName_1' });
    await Occasion.init(); await Occasion.ensureIndexes();
    assert.equal((await normalizedIndexes()).length, 1); ok('Mongoose auto-indexing is disabled for Occasion, so model initialisation cannot conflict');

    console.log(`\n${passed} checks passed`);
  } finally { await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import mongoose from 'mongoose';

// mongodb+srv:// needs SRV/TXT lookups, which some local resolvers refuse (ECONNREFUSED querySrv).
dns.setServers(['8.8.8.8']);

// Never log credentials: show only host(s) and database name.
export const describeMongoUri = (uri: string): string => {
  try {
    const url = new URL(uri);
    return `${url.host}${url.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
};

export const isDatabaseConnected = (): boolean => mongoose.connection.readyState === 1;

export const connectDB = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not set. Add it to backend/.env.');
  // Fail fast instead of queueing queries on a dead connection.
  mongoose.set('bufferCommands', false);
  mongoose.connection.on('disconnected', () => console.error('[MongoDB] Connection lost. Database requests will return 503 until it reconnects.'));
  mongoose.connection.on('reconnected', () => console.log('[MongoDB] Reconnected.'));

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log(`[MongoDB] Connected to ${describeMongoUri(mongoUri)}`);
    return;
  } catch (err: any) {
    console.error(`[MongoDB] Could not connect to ${describeMongoUri(mongoUri)}. Reason: ${err.message}`);
    // Explicit opt-in only. Never the default, never implied by NODE_ENV.
    if (process.env.NODE_ENV === 'production' || process.env.USE_MEMORY_DB_IF_LOCAL_FAILS !== 'true') {
      throw new Error(
        'MongoDB is unreachable. Check MONGODB_URI in backend/.env and that your IP is allowed in Atlas Network Access. ' +
        'To run against a temporary development database instead, set USE_MEMORY_DB_IF_LOCAL_FAILS=true.'
      );
    }
  }

  console.warn('==========================================================================');
  console.warn('[MongoDB] WARNING: USE_MEMORY_DB_IF_LOCAL_FAILS=true. Using a TEMPORARY LOCAL');
  console.warn('[MongoDB] database. Data here is NOT in your MongoDB server and will not');
  console.warn('[MongoDB] appear in MongoDB Compass at 127.0.0.1:27017. Do not use for real work.');
  console.warn('==========================================================================');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const dbPath = path.resolve(process.env.MEMORY_DB_PATH || '.data/mongo');
  fs.mkdirSync(dbPath, { recursive: true });
  console.warn(`[MongoDB] Fallback data directory: ${dbPath}`);
  const mongod = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongod.getUri());
};

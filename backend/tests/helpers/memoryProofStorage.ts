import { Readable } from 'node:stream';
import type { ProofStorage } from '../../src/config/proofStorage.js';

// In-memory stand-in for the private Space. `failPut` simulates a Spaces outage; `failRemove` a cleanup failure.
export function memoryProofStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const state = { failPut: false, failRemove: false, puts: 0, removes: 0, madePublic: [] as string[] };
  const storage: ProofStorage = {
    async put(key, body, contentType) { state.puts++; if (state.failPut) throw new Error('Spaces unavailable'); objects.set(key, { body: Buffer.from(body), contentType }); },
    async get(key) { const object = objects.get(key); if (!object) throw new Error('NoSuchKey'); return { stream: Readable.from([object.body]), size: object.body.length }; },
    publicUrl(key) { return `https://fake-bucket.fake-region.digitaloceanspaces.com/${key}`; },
    async makePublic(key) { if (!objects.has(key)) throw new Error('NoSuchKey'); state.madePublic.push(key); },
    async remove(key) { state.removes++; if (state.failRemove) throw new Error('remove failed'); objects.delete(key); },
  };
  return { storage, objects, state };
}

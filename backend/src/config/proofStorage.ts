import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

// Delivery proofs live in a PRIVATE DigitalOcean Space. The bucket is never read through DO_SPACES_CDN_BASE:
// every read goes through the authenticated API, which fetches the object with the server-side credentials.
export interface ProofStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; size?: number }>;
  remove(key: string): Promise<void>;
}

export const SPACES_ENV = ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_REGION', 'DO_SPACES_BUCKET'] as const;
export const missingSpacesEnv = (): string[] => SPACES_ENV.filter(name => !process.env[name]?.trim());

const normalizeEndpoint = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/+$/, '');

export function createSpacesStorage(): ProofStorage {
  const missing = missingSpacesEnv();
  if (missing.length) throw new Error(`DigitalOcean Spaces is not configured. Missing: ${missing.join(', ')}`);
  const bucket = process.env.DO_SPACES_BUCKET!.trim();
  const client = new S3Client({
    region: process.env.DO_SPACES_REGION!.trim(),
    endpoint: normalizeEndpoint(process.env.DO_SPACES_ENDPOINT!.trim()),
    credentials: { accessKeyId: process.env.DO_SPACES_KEY!.trim(), secretAccessKey: process.env.DO_SPACES_SECRET!.trim() },
    forcePathStyle: false,
  });
  return {
    async put(key, body, contentType) {
      // No ACL is sent, so the object inherits the bucket's private default.
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error('Empty object body');
      return { stream: result.Body as Readable, size: result.ContentLength };
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}

let current: ProofStorage | null = null;
export const getProofStorage = (): ProofStorage => (current ??= createSpacesStorage());
// Tests inject an in-memory implementation; pass null to reset.
export const setProofStorage = (storage: ProofStorage | null) => { current = storage; };

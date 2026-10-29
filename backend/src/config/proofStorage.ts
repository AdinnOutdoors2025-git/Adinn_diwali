import { DeleteObjectCommand, GetObjectCommand, PutObjectAclCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

// Delivery proofs live in a DigitalOcean Space with public-read objects: the viewer opens the direct Space object URL.
// Only the object key is stored in MongoDB; the URL is derived from the endpoint and bucket when needed.
// Object keys contain a random UUID, so a URL cannot be guessed, but anyone who has a URL can open it.
export interface ProofStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; size?: number }>;
  remove(key: string): Promise<void>;
  /** Direct (public) object URL on the Space endpoint, e.g. https://<bucket>.<region>.digitaloceanspaces.com/<key>. Not stored. */
  publicUrl(key: string): string;
  /** Makes an existing object publicly readable. Used only by the one-off proof ACL script. */
  makePublic(key: string): Promise<void>;
}

/** Virtual-host style object URL: https://<bucket>.<endpoint host>/<key> (never the CDN base). */
export const spacesObjectUrl = (endpoint: string, bucket: string, key: string): string => {
  const host = new URL(normalizeEndpoint(endpoint.trim())).host;
  return `https://${bucket}.${host}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

export const SPACES_ENV = ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_REGION', 'DO_SPACES_BUCKET'] as const;
export const missingSpacesEnv = (): string[] => SPACES_ENV.filter(name => !process.env[name]?.trim());

const normalizeEndpoint = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/+$/, '');

// Every proof upload explicitly requests public-read, so the direct Space URL opens without authentication.
export const proofPutInput = (bucket: string, key: string, body: Buffer, contentType: string) =>
  ({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length, ACL: 'public-read' as const });

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
      await client.send(new PutObjectCommand(proofPutInput(bucket, key, body, contentType)));
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error('Empty object body');
      return { stream: result.Body as Readable, size: result.ContentLength };
    },
    publicUrl(key) { return spacesObjectUrl(process.env.DO_SPACES_ENDPOINT!, bucket, key); },
    async makePublic(key) { await client.send(new PutObjectAclCommand({ Bucket: bucket, Key: key, ACL: 'public-read' })); },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}

let current: ProofStorage | null = null;
export const getProofStorage = (): ProofStorage => (current ??= createSpacesStorage());
// Tests inject an in-memory implementation; pass null to reset.
export const setProofStorage = (storage: ProofStorage | null) => { current = storage; };

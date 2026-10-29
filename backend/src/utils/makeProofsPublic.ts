// Makes delivery-proof objects under proofs/ publicly readable so their direct Space URLs open without authentication.
// It only changes the ACL of existing objects: no object is uploaded, overwritten or deleted, and MongoDB is not touched.
//   npx tsx src/utils/makeProofsPublic.ts             dry run: lists how many objects are not yet public
//   npx tsx src/utils/makeProofsPublic.ts --execute   sets public-read on those objects
import dotenv from 'dotenv';
dotenv.config();
import { GetObjectAclCommand, ListObjectsV2Command, PutObjectAclCommand, S3Client } from '@aws-sdk/client-s3';
import { missingSpacesEnv } from '../config/proofStorage.js';

async function main() {
  const missing = missingSpacesEnv();
  if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
  const execute = process.argv.includes('--execute');
  const endpoint = process.env.DO_SPACES_ENDPOINT!.trim();
  const client = new S3Client({
    region: process.env.DO_SPACES_REGION!.trim(), endpoint: /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`,
    credentials: { accessKeyId: process.env.DO_SPACES_KEY!.trim(), secretAccessKey: process.env.DO_SPACES_SECRET!.trim() },
  });
  const Bucket = process.env.DO_SPACES_BUCKET!.trim();
  let token: string | undefined, total = 0, alreadyPublic = 0, changed = 0;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: 'proofs/', ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      total++;
      const acl = await client.send(new GetObjectAclCommand({ Bucket, Key: object.Key! }));
      if ((acl.Grants ?? []).some(grant => grant.Grantee?.URI?.endsWith('/AllUsers') && grant.Permission === 'READ')) { alreadyPublic++; continue; }
      if (execute) { await client.send(new PutObjectAclCommand({ Bucket, Key: object.Key!, ACL: 'public-read' })); changed++; }
    }
    token = page.NextContinuationToken;
  } while (token);
  console.log(`Objects under proofs/: ${total} | already public: ${alreadyPublic} | ${execute ? `made public: ${changed}` : `would change: ${total - alreadyPublic} (dry run)`}`);
}
main().catch(error => { console.error('FAILED:', error?.name || error?.message || error); process.exit(1); });

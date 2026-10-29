# Deployment guide

Backend: Render. Frontend: Vercel (`frontend/vercel.json` rewrites `/api/*` to the Render backend).

## 1. Required Render environment variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (also disables the in-memory database fallback) |
| `MONGODB_URI` | Production Atlas connection string, set in the Render dashboard only |
| `JWT_SECRET` | At least 32 random characters. The server refuses to start in production if it is missing, short, or a known/published value |
| `USE_MEMORY_DB_IF_LOCAL_FAILS` | `false` |
| `CORS_ORIGINS` | Optional, comma-separated extra origins |
| `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_BUCKET` | Required for delivery-proof uploads. Proof objects are uploaded public-read (see below). `DO_SPACES_CDN_BASE` is not used. Proofs are capped at 2 MB (fixed in code; `MAX_PROOF_MB` is no longer read) |

Build command `npm install && npm run build`, start command `npm start`.

## 2. Rotate exposed credentials (manual, before deploying)

The previous `backend/.env.example` was committed with a real Atlas connection string and the JWT secret, so both must be treated as exposed (they remain in Git history and in any clone or fork). Rewriting history does not undo that; rotate instead.

**Atlas database user password**
1. Atlas > Database Access > edit the database user used by the app > Edit Password > generate a new one. Use only URL-safe characters or percent-encode them.
2. Build the new connection string and set it as `MONGODB_URI` in Render > Environment. Update your local `backend/.env` too.
3. Redeploy or restart the Render service and check `GET /api/health` returns `database: connected`.
4. Prefer giving the app its own user with only readWrite on the app database, and delete any other user that shared the old password.
5. Atlas > Network Access: remove IP entries you no longer need. Render's outbound IPs must be allowed (or `0.0.0.0/0` if you accept that, protected by the password).
6. Atlas > Security/Activity feed: check for connections from unknown IPs since the repository was pushed.

**JWT secret**
1. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
2. Set it as `JWT_SECRET` in Render and in local `backend/.env`.
3. Restart. Everyone is logged out once, which is expected (tokens last 7 days and old ones become invalid).

**Seeded accounts:** the dev seed creates accounts with documented default passwords. If production was seeded from it, change those passwords.

## 3. Backup before the first deploy

The new startup migrations modify indexes and add one field, so take a backup first.
- Atlas > Backup > Take Snapshot Now (paid tiers), or
- `mongodump --uri "<MONGODB_URI>" --out ./backup-YYYYMMDD` (keep the folder out of Git and store it somewhere private), and confirm it contains `clients`, `clientassociations`, `sweetdistributions`, `bds`.

## 4. What the migration does at startup (idempotent)

1. `clients`: no longer touched. Distribution quantity is fixed at 5 in code (`DISTRIBUTION_QUANTITY`); any old `allowedQuantity` field already stored on clients is simply ignored and left in place.
2. `clientassociations`: the old unique index on client + vertical + requestee is dropped and a unique index on client + type + requestee is created. It applies only to records that have a Type, so existing records are unaffected.
3. Existing associations keep their `vertical` and show as "Unassigned" until a Type is assigned. Existing distributions have no mode/status and show as "Legacy".
4. No records are deleted or rewritten, and `SweetDistribution` indexes are unchanged.

Run order: deploy the backend first (confirm `/api/health`), then the frontend. A new frontend against the old backend fails with "Valid Vertical is required".

## 5. Rollback

- **Code:** redeploy the previous Render deploy (Render > Deploys > Rollback) and the previous Vercel deployment. The old code keeps working with the data: the new unique index ignores records without a Type, and the added fields are ignored.
- **Index:** the old unique index is not recreated by the old code. Only if you need it back (it is not required for the old code to run): `db.clientassociations.createIndex({client:1, vertical:1, bd:1}, {unique:true})`. This can fail if Type-based data now has several records sharing a vertical.
- **Data:** distributions created after the deploy (with quantity, mode, status, proof) stay in the database; the old code ignores those fields. To fully restore, restore the snapshot or `mongodump` taken in step 3 (this discards everything entered since). Delivery proofs live in the `deliveryproofs` collection.

## 6. Post-deploy checks

1. `GET /api/health` returns 200 and `connected`.
2. Log in, load Entry, confirm old rows show "Unassigned" / "Legacy" and no data is missing.
3. Upload one 1-2 MB JPEG proof on a Courier > Delivered record and view it. This goes through the Vercel rewrite, whose request-size limit is not verified here. If it fails, check the Vercel request-size limit.
4. Atlas storage: new proofs are stored in the DigitalOcean Space (public-read objects) (up to 2 MB each); proofs uploaded before this change stay in MongoDB and remain viewable. Check that Spaces uploads and viewing work after deploy.

## Delivery proof viewing (direct Space URLs)
- No new environment variables. Uploads use the existing `DO_SPACES_*` credentials on the backend only.
- New proofs are uploaded with a `public-read` ACL. MongoDB stores only the object key; `GET /api/distributions/:id/proof-url` (login + STAFF/CMD role) returns the direct URL `https://<bucket>.<region>.digitaloceanspaces.com/<key>`, built from `DO_SPACES_ENDPOINT` and `DO_SPACES_BUCKET` (not the CDN base). The viewer loads that URL directly. Legacy MongoDB proofs fall back to `GET /api/distributions/:id/proof`.
- **Privacy trade-off:** anyone who has a proof URL can open it without logging in. Keys contain a random UUID so URLs cannot be guessed, but they are not secret once shared. Only the `proofs/` objects are public; the bucket itself still has no public listing.
- Objects uploaded earlier with a private ACL are made public by `npx tsx src/utils/makeProofsPublic.ts --execute` (dry run without the flag). It only changes ACLs.

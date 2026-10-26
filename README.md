# Diwali Sweet Distribution Management System

A web application designed for **Adinn Advertising** to manage client and vendor registrations and record annual corporate Diwali sweet distributions across 10 business verticals and assigned Business Developers (BDs).

---

## 1. System Architecture & Structure

The system separates **Client & BD Registration** from **Sweet Distribution Tracking**:

```
Staff Operations
│
├── Home (/staff)
│   └── Operational overview & festive dashboard
│
├── Entry (/staff/entry)
│   └── Annual Sweet Distribution Tracker
│       ├── Header Filters: Year, Vertical, BD, Search
│       ├── Table: S.No., Client/Vendor Name, Mobile Number, Vertical, BD, Created At, Last Given, Action
│       ├── Eligibility calculation: 1 box per client per calendar year across all verticals & BDs
│       └── Action: "Add Distribution" (saves to distribution history, prevents duplicate submissions)
│
└── Add (/staff/add)
    └── Client and BD Management
        ├── Predefined 10 Business Verticals
        ├── Searchable BD dropdown + "+ Add BD" modal
        ├── Client registration (Name required, Mobile required, Email optional)
        ├── Normalized identity reuse across multiple Verticals/BDs
        ├── Excel bulk import with preview & validation
        └── IMPORTANT: Adding clients/BDs NEVER creates a sweet distribution record
```

---

## 2. Technology Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Lucide React, SheetJS (`xlsx`)
- **Backend**: Node.js, Express, TypeScript, Mongoose ODM, Multer, bcryptjs, JSON Web Tokens (JWT)
- **Database**: MongoDB with Mongoose ODM (with automatic in-memory fallback for instant zero-configuration local execution)
- **Design**: Professional dark navy collapsible sidebar (`#0F172A`), white content surfaces, subtle neutral backgrounds, and Diwali gold/amber accents.

---

## 3. Database Schema

- **`User`** (`src/models/User.ts`): System credentials with role-based authorization (`STAFF` or `CMD`).
- **`BD`** (`src/models/BD.ts`): Business Developers (`name`, `email`).
- **`Client`** (`src/models/Client.ts`): Master client identity with normalized name and mobile to avoid duplication across verticals.
- **`ClientAssociation`** (`src/models/ClientAssociation.ts`): Maps client identity to a specific `Vertical` and `BD`.
- **`SweetDistribution`** (`src/models/SweetDistribution.ts`):
  - Records sweet distribution events referencing `client`, `distributionYear`, `vertical`, `bd`, `distributedAt`, `distributedBy`, `notes`.
  - **Database Unique Constraint**:
    ```typescript
    SweetDistributionSchema.index({ client: 1, distributionYear: 1 }, { unique: true });
    ```
    Guarantees at the database level that a client can receive sweets only once per calendar year across all verticals and BDs, including concurrent submissions.
  - `Last Given` is computed dynamically from distribution history rather than client creation date.

---

## 4. API Endpoints

### Sweet Distribution
- `GET /api/distributions?year=:y&vertical=:v&bd=:b&search=:q&page=:p&limit=:l` - Returns client list with computed `Last Given`, `isEligible`, and `currentYearDistribution`
- `POST /api/distributions` - Record sweet distribution (validates and prevents duplicate yearly distributions)

### Client & BD Management
- `GET /api/clients?vertical=:v&bd=:b&search=:q&page=:p&limit=:l` - List clients for selected Vertical and BD
- `POST /api/clients` - Register/link client (Name req, Mobile req, Email opt; never creates distribution)
- `PUT /api/clients/:id` - Update client contact details
- `DELETE /api/clients/:id` - Remove client association
- `POST /api/clients/bulk-import` - Bulk parse, deduplicate, and register clients from Excel
- `GET /api/clients/sample-template` - Download standard sample Excel template
- `GET /api/bds` - List all BDs
- `POST /api/bds` - Create new BD
- `DELETE /api/bds/:id` - Remove BD

### Authentication
- `POST /api/auth/login` - Staff & CMD login
- `GET /api/auth/me` - Current user profile
- `POST /api/auth/seed` - Re-initialize default admin/staff accounts

---

## 5. Demo Credentials

| Role | Email | Password | Access Portal |
|---|---|---|---|
| **Staff Member** | `staff@adinn.com` | `Staff@123` | Staff Portal (`/staff`, `/staff/entry`, `/staff/add`) |
| **Managing Director** | `cmd@adinn.com` | `Cmd@123` | CMD Portal (`/cmd`) |

---

## 6. Setup & Execution

1. **Install Dependencies**:
   ```bash
   npm run install:all
   ```
2. **Start Backend Server**:
   ```bash
   cd backend
   npm run dev
   ```
   *Runs on `http://localhost:6000` (the `PORT` configured in `backend/.env`). The frontend uses `/api`, which Vite proxies to `http://127.0.0.1:6000`. Restart Vite after changing its proxy configuration. Port 6000 is accessed through the proxy because browsers restrict direct requests to that port.*
3. **Start Frontend Development Server**:
   ```bash
   cd frontend
   npm run dev
   ```
   *Opens at `http://localhost:5173`.*

### Replace the BD master from the October workbook

The BD source of truth remains the existing MongoDB `bds` collection exposed by `/api/bds`. The current dataset exactly matches `Sheet1` in `D:\Adinn-assets\MAIL USERS LIST OCT-2026.xlsx`, using `NAME`, `Email Address`, and `Status`: 204 valid Active entries. Four names occur with distinct emails and remain separate source-provided records. There are no invalid or duplicate email rows.

From `backend`, run `npm run build`, then a dry run:

```powershell
node dist/utils/replaceBDs.js --file "D:\Adinn-assets\MAIL USERS LIST OCT-2026.xlsx" --mongo-uri "<live MongoDB URI>" --api-url "http://127.0.0.1:6000" --report "import-reports/bd-replacement-dry-run.json"
```

After reviewing the plan, add `--apply` and use a separate report path. The script validates the live API/database identity, preserves exact source name strings and normalized email mappings, reuses shared email IDs, changes names only where unreferenced, adds missing source entries, and removes obsolete unreferenced BDs. It refuses ambiguous mappings or historical references to changed/obsolete names rather than guessing. It never calls the existing cascading BD DELETE endpoint. A pre-change BD backup and before/after hashes of all other collections are saved. The final email/name set must equal the source exactly, not the union of old and new datasets.

The October replacement kept 185 entries unchanged, renamed 6 unreferenced entries, inserted 13, and removed 7 obsolete unreferenced entries, producing exactly 204 BDs. Client records, associations, users, and distribution histories were preserved byte-for-byte. The older `importBDs` utility performs append-only imports and is not the replacement workflow.

The running application still uses temporary MongoDB fallback storage. To retain data through restarts, configure persistent MongoDB; neither import utility starts another fallback database or changes connection settings.

### Master Entry page

`/staff/entry` uses a single master search, Year/Vertical/BD/Distribution Status filters, and a client identity table. Each client appears once with its matching associations, master creation timestamp, and active distribution history. Search and status filtering run on the backend before pagination. Add Client/Vendor inserts editable rows into that same table. Excel / BD Tools preserves the existing Excel preview/import and Add BD functionality.

`POST /api/distributions/:id/revert` requires an authenticated Staff or CMD user and a reason of 5–1000 characters. Revert retains the original distribution and notes, adding `isReverted`, `revertedAt`, `revertedBy`, and `revertReason`. Reverted distributions no longer affect annual eligibility or Last Given. The client master and other years' distributions remain intact.

On startup, the backend establishes unique normalized-name and normalized-phone indexes matching the existing identity reuse rules. It also marks legacy distributions as active without changing their timestamps, creates a unique client/year index for active distributions, then removes the former unrestricted annual index. This preserves annual uniqueness while allowing an audited revert followed by redistribution. Existing identity conflicts cause index creation to fail for review; the application never silently merges or deletes conflicting clients.

Build both projects with `npm run build` from the repository root. With the frontend/backend running, use `node frontend/tests/entry.smoke.cjs` for browser, API, MongoDB uniqueness, Excel, and Revert checks, and `node frontend/tests/auth.smoke.cjs` for authentication regressions. The tests require Playwright (or `PLAYWRIGHT_MODULE` pointing to an installed copy). Set `ENTRY_TEST_MONGO_URI` to the running backend's actual database for Entry tests; they verify the authenticated user ID matches that database, create uniquely named test fixtures, remove only those fixtures, and compare original document hashes afterward.

### Unified login and Entry export

The Login page sends the existing username/email identifier and password to `POST /api/auth/login` without a manually selected role. It uses the returned user role for navigation: STAFF to `/staff`, CMD to `/cmd`. Existing JWTs, storage keys, session verification, and role guards are unchanged. Portal tabs and demo credential buttons are removed.

Entry has an Export Excel button at the top right. The existing authenticated, paginated Entry API supplies all matching clients, including the current master search, year, Vertical, BD, and status filters. The latest BD master is fetched at export time. There is no analytics page or report-specific backend API.

The workbook now has Summary, Distribution Details, Vertical Analytics, and BD Analytics sheets. The theme uses navy `#14213D`, saffron `#F59E0B`, gold `#FCD34D`, ivory `#FFFBEB`, emerald `#059669`, rose `#E11D48`, white, and slate metadata. It includes merged KPI cards, striped tables, subtle borders, wrapped text, suitable widths/heights, frozen headers, autofilters, percentage formats, and print settings. Currency fields are not invented when none exist in the data.

`Distribution Marked` replaces only the former `Distribution Date (IST)` heading. Date strings retain the existing readable IST values and data types; no database timestamp or distribution logic is changed. Completed/pending colors use actual selected-year status, excluding reverted distributions. Overall metrics count each identity once. Vertical/BD groups may overlap, while distribution credit goes once to its recorded BD and Vertical. BD Analytics includes every current BD master entry with its exact name and email, including zero-activity rows.

The same SheetJS library supplies ZIP packaging for native SpreadsheetML styles and three editable Excel charts in Summary. Given/Not Given uses emerald/rose, Vertical comparison uses navy/saffron, and BD performance uses navy/gold/saffron. Every series references worksheet cells and includes matching caches. BD chart ranges are derived from relevant source-backed activity, without invented names or sample metrics.

Run `node frontend/tests/entry-export.smoke.cjs` with `ENTRY_TEST_MONGO_URI` and Playwright as above. Independent Excel verification requires Python `openpyxl`; it checks source BD dropdowns, 101-client pagination, filters/empty exports, four sheets, styles, statuses, KPI/group calculations, exact date values, native chart colors/cache references, mobile placement, download failures, and unchanged original database hashes after fixture cleanup.
#   a d i n n - d i w a l i  
 
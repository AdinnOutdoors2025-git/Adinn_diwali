// Real application integration tests. Test-only fixtures are removed by exact client IDs.
// Requires ENTRY_TEST_MONGO_URI pointing to the LIVE backend database and Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const XLSX = require('../../backend/node_modules/xlsx');
const { MongoClient, ObjectId } = require('../../backend/node_modules/mongodb');
const base = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:5173';
const prefix = `Master Entry Check ${Date.now()}`;
const fixture = suffix => `${prefix} ${suffix}`;
const mobile = suffix => `98${String(Date.now()).slice(-7)}${suffix}`;
const normalize = value => value.trim().toLowerCase().replace(/\s+/g, ' ');
const hash = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const output = path.resolve(__dirname, '../test-results');

async function main() {
  assert.ok(process.env.ENTRY_TEST_MONGO_URI, 'ENTRY_TEST_MONGO_URI is required');
  const client = new MongoClient(process.env.ENTRY_TEST_MONGO_URI);
  await client.connect();
  const db = client.db();
  const collections = ['bds', 'users', 'clients', 'clientassociations', 'sweetdistributions'];
  const before = {};
  for (const name of collections) before[name] = await db.collection(name).find().sort({ _id: 1 }).toArray();
  const originalIDs = new Set(before.clients.map(row => String(row._id)));
  const passed = [];
  const pass = label => { passed.push(label); console.log(`PASS: ${label}`); };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/login`);
    await page.getByRole('textbox', { name: 'Username or email', exact: true }).fill('staff@adinn.com');
    await page.locator('input[type=password]').fill('Staff@123');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL(`${base}/staff`);
    const token = await page.evaluate(() => localStorage.getItem('adinn_diwali_token'));
    const call = async (route, method = 'GET', body, authenticated = true) => {
      const response = await fetch(`${base}/api${route}`, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    const me = await call('/auth/me');
    assert.ok(await db.collection('users').findOne({ _id: new ObjectId(me.data.user.id), email: me.data.user.email }), 'Test database must match live API');
    const bds = (await call('/bds')).data.data;
    assert.ok(bds.length >= 2);
    const year = new Date().getFullYear();
    const query = async params => {
      const response = await call(`/distributions?${new URLSearchParams({ year: String(year), limit: '100', ...params })}`);
      assert.equal(response.status, 200); return response.data;
    };
    const defaults = await query({});
    assert.equal(defaults.pagination.total, before.clients.length);
    pass('Default master list contains all client identities, including clients without associations');
    await page.goto(`${base}/staff/entry`);
    const search = page.getByRole('searchbox', { name: 'Global master search', exact: true });
    await search.waitFor();
    const table = page.getByRole('table', { name: 'Client/vendor distribution', exact: true });
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.deepEqual(await table.locator('thead th').allTextContents(), ['S.No.', 'Client/Vendor Name', 'Phone Number', 'Email', 'Type', 'Requestee Name', 'Requestee Email', 'Quantity', 'Created At', 'Last Given', 'Mode', 'Status', 'Action']);
    const add = page.getByRole('button', { name: 'Add Client/Vendor', exact: true });
    await add.click(); await add.click();
    const drafts = table.locator('[data-draft-row]');
    await drafts.nth(1).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Add Client / Vendor', exact: true }).count(), 0);
    await drafts.nth(0).getByRole('button', { name: 'Save', exact: true }).click();
    await drafts.nth(0).getByRole('alert').waitFor();
    const fill = async (row, name, phone, email, type, bd) => {
      await row.getByRole('textbox', { name: 'Client/Vendor Name', exact: true }).fill(name);
      await row.getByRole('textbox', { name: 'Phone Number', exact: true }).fill(phone);
      await row.getByRole('textbox', { name: 'Email ID (Optional)', exact: true }).fill(email);
      await row.getByRole('combobox', { name: 'Client Type', exact: true }).selectOption(type);
      await row.getByRole('combobox', { name: 'Client BD', exact: true }).selectOption(bd);
    };
    const aPhone = mobile(1), bPhone = mobile(2), cPhone = mobile(3), dPhone = mobile(4);
    await fill(drafts.nth(0), fixture('A'), aPhone, 'entry-a@example.com', 'Roadshow', bds[0]._id);
    await fill(drafts.nth(1), fixture('B'), bPhone, '', 'Outdoor', bds[1]._id);
    const save = async row => {
      const pending = page.waitForResponse(response => response.url().endsWith('/api/clients') && response.request().method() === 'POST');
      await row.getByRole('button', { name: 'Save', exact: true }).click();
      const response = await pending; assert.equal(response.status(), 201); return (await response.json()).data;
    };
    const a = await save(drafts.nth(0));
    const b = await save(drafts.nth(0));
    const rowA = table.locator(`[data-client-id="${a.clientId}"]`);
    await rowA.waitFor();
    assert.equal(await db.collection('sweetdistributions').countDocuments(), before.sweetdistributions.length);
    await add.click(); await drafts.nth(0).getByRole('button', { name: 'Cancel', exact: true }).click();
    pass('Inline rows use the main table; validation, multiple saves and Cancel work without client modals or automatic distributions');

    await add.click();
    await fill(drafts.nth(0), ` ${fixture('A').toUpperCase()} `, `+91 ${aPhone}`, '', 'Roadshow', bds[0]._id);
    const duplicateSave = page.waitForResponse(response => response.url().endsWith('/api/clients') && response.request().method() === 'POST');
    await drafts.nth(0).getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal((await duplicateSave).status(), 409);
    await drafts.nth(0).getByRole('alert').waitFor();
    await drafts.nth(0).getByRole('button', { name: 'Cancel', exact: true }).click();
    await rowA.getByRole('button', { name: 'Link association', exact: true }).click();
    await drafts.nth(0).getByRole('combobox', { name: 'Client Type', exact: true }).selectOption('Outdoor');
    await drafts.nth(0).getByRole('combobox', { name: 'Client BD', exact: true }).selectOption(bds[1]._id);
    const linked = await save(drafts.nth(0)); assert.equal(linked.clientId, a.clientId);
    const all = await query({ search: prefix });
    assert.equal(all.pagination.total, 2); assert.equal(all.data.find(row => row.clientId === a.clientId).associations.length, 2);
    pass('Normalized duplicates are blocked and new Type/Requestee associations reuse the same master identity');

    for (const value of [fixture('A'), aPhone, 'entry-a@example.com', bds[0].name, bds[0].email]) {
      const result = await query({ search: value });
      assert.ok(result.data.some(row => row.clientId === a.clientId));
    }
    assert.equal((await query({ search: '[' })).pagination.total, 0);
    const waitSearch = async value => {
      const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/distributions' && (new URL(response.url()).searchParams.get('search') || '') === value);
      await search.fill(value); await response;
    };
    await waitSearch('entry-a@example.com'); await rowA.waitFor();
    await waitSearch(bds[0].email); await rowA.waitFor();
    await waitSearch('');
    pass('Master search finds client name, phone, email, BD name and BD email; regex characters are handled safely');
    const aDoc = await db.collection('clients').findOne({ _id: new ObjectId(a.clientId) });
    const record = (await query({ search: fixture('A') })).data[0];
    assert.equal(record.createdAt, aDoc.createdAt.toISOString());
    assert.equal(record.lastGiven, null); assert.equal(record.bd.email, bds[1].email === record.bd.email ? bds[1].email : bds[0].email);
    assert.equal(record.clientEmail, 'entry-a@example.com');
    pass('Created At is the client master timestamp; optional values and Last Given reflect real stored data');

    const orphan = await call('/clients', 'POST', { name: fixture('Unlinked'), mobile: cPhone, type: 'Govt. Official', bd: bds[0]._id });
    assert.equal(orphan.status, 201); assert.equal((await call(`/clients/${orphan.data.data._id}`, 'DELETE')).status, 200);
    const orphanRecord = (await query({ search: fixture('Unlinked') })).data[0];
    assert.equal(orphanRecord.associations.length, 0);
    assert.equal((await query({ search: prefix })).pagination.total, 3);
    const phoneSearch = await query({ search: aPhone, type: 'Govt. Official', bd: bds[0]._id, status: 'NOT_GIVEN' });
    assert.equal(phoneSearch.pagination.total, 1);
    assert.equal((await query({ search: bds[1].email, type: 'Govt. Official', bd: bds[0]._id })).pagination.total, 0);
    assert.equal((await query({ search: prefix, status: 'GIVEN' })).pagination.total, 0);
    assert.equal((await query({ search: prefix, status: 'NOT_GIVEN' })).pagination.total, 3);
    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('Roadshow');
    await page.getByRole('combobox', { name: 'BD', exact: true }).selectOption(bds[0]._id);
    await rowA.waitFor();
    pass('Type, Requestee and year-specific status filters combine with search; unlinked clients remain in the default master list');

    await page.getByRole('button', { name: 'Excel / BD Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Add BD', exact: true }).click();
    await page.getByRole('heading', { name: 'Add Business Developer (BD)', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Excel import preview', exact: true });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { 'Client/Vendor Name': fixture('D'), 'Mobile Number': dPhone, 'Email ID': '' },
      { 'Client/Vendor Name': fixture('D').toUpperCase(), 'Mobile Number': `+91 ${dPhone}`, 'Email ID': '' },
      { 'Client/Vendor Name': '', 'Mobile Number': cPhone, 'Email ID': '' },
      { 'Client/Vendor Name': fixture('A'), 'Mobile Number': aPhone, 'Email ID': '' },
    ]), 'Clients');
    await preview.locator('input[type=file]').setInputFiles({ name: 'master-entry-check.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    await preview.getByText('Missing Name', { exact: true }).first().waitFor();
    await preview.getByText('Duplicate in File', { exact: true }).waitFor();
    await preview.getByText('Already Registered Here', { exact: true }).waitFor();
    const excelResponse = page.waitForResponse(response => response.url().endsWith('/api/clients/bulk-import'));
    await preview.getByRole('button', { name: 'Confirm & Import 1 Records', exact: true }).click();
    assert.equal((await excelResponse).status(), 200);
    await preview.getByText('Import Completed!', { exact: true }).waitFor();
    await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
    await table.getByText(fixture('D'), { exact: true }).waitFor();
    assert.equal(await db.collection('sweetdistributions').countDocuments(), before.sweetdistributions.length);
    pass('Existing Excel preview/import, validation, duplicate detection and Add BD remain operational');

    await rowA.getByRole('button', { name: 'Add Distribution', exact: true }).click();
    await page.getByRole('textbox', { name: 'Distribution notes', exact: true }).fill('Actual application integration check');
    const givenPromise = page.waitForResponse(response => response.url().endsWith('/api/distributions') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirm Sweet Distribution', exact: true }).click();
    const givenResponse = await givenPromise; assert.equal(givenResponse.status(), 201);
    const givenID = (await givenResponse.json()).data._id;
    await rowA.getByText(`Given in ${year}`, { exact: true }).waitFor();
    const duplicate = await call('/distributions', 'POST', { clientId: a.clientId, year, type: 'Vendor', bd: bds[1]._id, quantity: 1, mode: 'IN_PERSON' });
    assert.equal(duplicate.status, 409);
    const nextYear = await call('/distributions', 'POST', { clientId: a.clientId, year: year + 1, type: 'Vendor', bd: bds[1]._id, quantity: 1, mode: 'IN_PERSON' });
    assert.equal(nextYear.status, 201);
    const nextID = nextYear.data.data._id;
    assert.equal((await query({ search: prefix, status: 'GIVEN' })).pagination.total, 1);
    const nextHistory = (await query({ search: fixture('A') })).data[0];
    assert.equal(nextHistory.lastGiven, year + 1); assert.equal(nextHistory.lastGivenDate, nextYear.data.data.distributedAt);
    const filterStatus = page.getByRole('combobox', { name: 'Distribution Status', exact: true });
    await filterStatus.selectOption('GIVEN'); await rowA.waitFor();
    await page.getByRole('combobox', { name: 'Year', exact: true }).selectOption(String(year + 2));
    const nextFilterResponse = page.waitForResponse(response => response.url().includes('/api/distributions?') && new URL(response.url()).searchParams.get('year') === String(year + 2) && new URL(response.url()).searchParams.get('status') === 'NOT_GIVEN');
    await filterStatus.selectOption('NOT_GIVEN'); await nextFilterResponse;
    await rowA.getByRole('button', { name: 'Add Distribution', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Year', exact: true }).selectOption(String(year));
    await filterStatus.selectOption('ALL');
    await rowA.getByRole('button', { name: 'Revert', exact: true }).waitFor();
    pass('Given/Not Given recalculates for the chosen year; duplicate distribution is blocked globally and subsequent years remain eligible');

    assert.equal((await call(`/distributions/${givenID}/revert`, 'POST', { reason: 'mistake' }, false)).status, 401);
    assert.equal((await call(`/distributions/${givenID}/revert`, 'POST', { reason: 'bad' })).status, 400);
    await rowA.getByRole('button', { name: 'Revert', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await db.collection('sweetdistributions').findOne({ _id: new ObjectId(givenID) })).isReverted, false);
    await rowA.getByRole('button', { name: 'Revert', exact: true }).click();
    await page.getByRole('textbox', { name: 'Revert reason', exact: true }).fill('Incorrect distribution recorded during verification');
    const revertPromise = page.waitForResponse(response => response.url().endsWith(`/api/distributions/${givenID}/revert`));
    await page.getByRole('button', { name: 'Confirm Revert', exact: true }).click();
    assert.equal((await revertPromise).status(), 200);
    await rowA.getByRole('button', { name: 'Add Distribution', exact: true }).waitFor();
    const reverted = await db.collection('sweetdistributions').findOne({ _id: new ObjectId(givenID) });
    assert.equal(reverted.isReverted, true); assert.ok(reverted.revertedAt); assert.equal(String(reverted.revertedBy), me.data.user.id);
    assert.equal(reverted.revertReason, 'Incorrect distribution recorded during verification');
    assert.equal(reverted.notes, 'Actual application integration check');
    assert.equal((await db.collection('sweetdistributions').findOne({ _id: new ObjectId(nextID) })).isReverted, false);
    assert.ok(await db.collection('clients').findOne({ _id: new ObjectId(a.clientId) }));
    assert.equal((await call(`/distributions/${givenID}/revert`, 'POST', { reason: 'Repeated reversal rejected' })).status, 404);
    assert.equal((await query({ search: fixture('A'), status: 'NOT_GIVEN' })).pagination.total, 1);
    assert.equal((await call('/distributions', 'POST', { clientId: a.clientId, year, type: 'Vendor', bd: bds[1]._id, quantity: 1, mode: 'IN_PERSON' })).status, 201);
    pass('Confirmed Revert requires authentication/reason, preserves record/notes/actor, affects only the selected record and restores annual eligibility');

    const concurrent = await Promise.all([
      call('/distributions', 'POST', { clientId: a.clientId, year: year + 2, type: 'Govt. Official', bd: bds[0]._id, quantity: 1, mode: 'IN_PERSON' }),
      call('/distributions', 'POST', { clientId: a.clientId, year: year + 2, type: 'Vendor', bd: bds[1]._id, quantity: 1, mode: 'IN_PERSON' }),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
    const indexes = await db.collection('sweetdistributions').indexes();
    assert.ok(indexes.some(index => index.unique && index.key.client === 1 && index.key.distributionYear === 1 && index.partialFilterExpression.isReverted === false));
    const active = await db.collection('sweetdistributions').findOne({ _id: new ObjectId(nextID) });
    await assert.rejects(() => db.collection('sweetdistributions').insertOne({ ...active, _id: new ObjectId() }), error => error.code === 11000);
    pass('Backend and MongoDB both reject concurrent/duplicate active client-year records while retaining reverted history');

    const concurrentIdentity = await Promise.all([
      call('/clients', 'POST', { name: fixture('Concurrent'), mobile: mobile(5), type: 'Govt. Official', bd: bds[0]._id }),
      call('/clients', 'POST', { name: fixture('Concurrent'), mobile: mobile(5), type: 'Vendor', bd: bds[1]._id }),
    ]);
    assert.deepEqual(concurrentIdentity.map(result => result.status), [201, 201]);
    assert.equal(concurrentIdentity[0].data.data.clientId, concurrentIdentity[1].data.data.clientId);
    assert.equal(await db.collection('clients').countDocuments({ normalizedName: normalize(fixture('Concurrent')) }), 1);
    assert.equal((await call('/clients', 'POST', { name: fixture('Invalid Phone'), mobile: 'abc123', type: 'Govt. Official', bd: bds[0]._id })).status, 400);
    pass('Concurrent client registrations reuse one MongoDB identity; invalid phones are rejected by the backend');

    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('ALL');
    await page.getByRole('combobox', { name: 'BD', exact: true }).selectOption('ALL');
    const freshResponse = page.waitForResponse(response => response.url().includes('/api/distributions?'));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await freshResponse;
    await table.locator(`[data-client-id="${orphan.data.data.clientId}"]`).waitFor();
    await page.getByRole('button', { name: 'Close notification', exact: true }).evaluateAll(buttons => buttons.forEach(button => button.click()));
    fs.mkdirSync(output, { recursive: true });
    await page.locator('[data-client-table-scroll]').evaluate(el => { el.scrollLeft = 0; });
    await page.screenshot({ path: path.join(output, 'entry-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().right <= 1);
    await page.waitForFunction(() => document.querySelector('main').getBoundingClientRect().left < 30);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.locator('[data-client-table-scroll]').evaluate(el => el.scrollWidth > el.clientWidth), true);
    await page.locator('[data-client-table-scroll]').evaluate(el => { el.scrollLeft = 0; });
    await page.screenshot({ path: path.join(output, 'entry-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    pass('Desktop/mobile layouts retain the branding and use table scrolling without horizontal page overflow');
  } finally {
    if (browser) await browser.close();
    const own = (await db.collection('clients').find({ normalizedName: { $regex: `^${normalize(prefix)}` } }).toArray()).filter(row => !originalIDs.has(String(row._id))).map(row => row._id);
    await db.collection('sweetdistributions').deleteMany({ client: { $in: own } });
    await db.collection('clientassociations').deleteMany({ client: { $in: own } });
    await db.collection('clients').deleteMany({ _id: { $in: own } });
    for (const name of collections) assert.equal(hash(await db.collection(name).find().sort({ _id: 1 }).toArray()), hash(before[name]), `${name}: existing data must remain unchanged`);
    await client.close();
    console.log('PASS: All test fixtures removed; original database document hashes match.');
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'entry-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed, originalDataPreserved: true, success: true }, null, 2));
  console.log(`${passed.length} master Entry UI/backend checks passed.`);
}
main().catch(error => { console.error('FAIL:', error.stack); process.exitCode = 1; });

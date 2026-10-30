// Actual browser/API export checks. Only uniquely named fixtures are created and removed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { MongoClient, ObjectId } = require('../../backend/node_modules/mongodb');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const XLSX = require('../../backend/node_modules/xlsx');
const base = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = path.resolve(__dirname, '../test-results');
const prefix = `Entry Export Check ${Date.now()}`;
const headings = ['S.No.', 'Client/Vendor Name', 'Phone Number', 'Email', 'Type', 'Requestee Name', 'Requestee Email', 'Created At (IST)', 'Distribution Year', 'Allowed Quantity', 'Distribution Quantity', 'Mode', 'Status', 'Distribution Status', 'Distribution Marked', 'Last Given Year'];
const hash = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');

async function main() {
  assert.ok(process.env.ENTRY_TEST_MONGO_URI, 'ENTRY_TEST_MONGO_URI is required');
  const connection = new MongoClient(process.env.ENTRY_TEST_MONGO_URI);
  await connection.connect();
  const db = connection.db();
  const names = ['clients', 'clientassociations', 'sweetdistributions', 'bds', 'users'];
  const snapshot = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await db.collection(name).find().sort({ _id: 1 }).toArray())])));
  const before = await snapshot();
  let browser;
  const passed = [];
  const pass = text => { passed.push(text); console.log(`PASS: ${text}`); };
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${base}/login`);
    await page.getByRole('textbox', { name: 'Username or email', exact: true }).fill('staff@adinn.com');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Staff@123');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL(`${base}/staff`);
    const token = await page.evaluate(() => localStorage.getItem('adinn_diwali_token'));
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(`${base}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.ok(response.ok, `${route} returned ${response.status}`); return response.json();
    };
    const me = await call('/auth/me');
    assert.ok(await db.collection('users').findOne({ _id: new ObjectId(me.user.id) }), 'Test database must match the API');
    const bds = (await call('/bds')).data; assert.ok(bds.length >= 2);
    const source = XLSX.utils.sheet_to_json(XLSX.readFile('D:/Adinn-assets/MAIL USERS LIST OCT-2026.xlsx').Sheets.Sheet1);
    const pairs = rows => rows.map(row => JSON.stringify([row.name, row.email.trim().toLowerCase()])).sort();
    assert.equal(bds.length, 204);
    assert.deepEqual(pairs(bds), pairs(source.map(row => ({ name: row.NAME, email: row['Email Address'] }))));
    pass('BD master equals all 204 October source entries exactly, with no old/new union');
    const existingPhones = new Set((await db.collection('clients').find().toArray()).map(row => row.normalizedMobile));
    let phone = 9600000000 + Math.floor(Math.random() * 1000000);
    const records = Array.from({ length: 101 }, (_, index) => {
      while (existingPhones.has(String(phone))) phone++;
      return { name: `${prefix} ${String(index).padStart(3, '0')}`, mobile: String(phone++), email: index === 0 ? 'entry-export@example.com' : '' };
    });
    const imported = await call('/clients/bulk-import', 'POST', { type: 'Govt. Official', bd: bds[0]._id, records });
    assert.equal(imported.summary.successful, 101);
    const first = await db.collection('clients').findOne({ normalizedName: records[0].name.toLowerCase() });
    const linked = await call('/clients', 'POST', { quantity: 3, ...records[0], type: 'Vendor', bd: bds[1]._id });
    assert.equal(linked.data.clientId, String(first._id));
    for (const year of [2026, 2027]) await call('/distributions', 'POST', { clientId: String(first._id), year, type: 'Govt. Official', bd: bds[0]._id, quantity: 1, mode: 'IN_PERSON' });
    const phase = await snapshot();

    await page.goto(`${base}/staff/reports`);
    await page.waitForURL(`${base}/staff/entry`);
    const button = page.getByRole('button', { name: 'Export Excel', exact: true });
    await button.waitFor();
    const labels = bds.map(row => `${row.name} (${row.email})`).sort();
    assert.deepEqual((await page.getByRole('combobox', { name: 'BD', exact: true }).locator('option').allTextContents()).slice(1).sort(), labels);
    await page.getByRole('button', { name: 'Add Client/Vendor', exact: true }).click();
    const draft = page.locator('[data-draft-row]').first();
    assert.deepEqual((await draft.getByRole('combobox', { name: 'Client BD', exact: true }).locator('option').allTextContents()).slice(1).sort(), labels);
    await draft.getByRole('button', { name: 'Cancel', exact: true }).click();
    pass('Entry filter and inline client BD dropdowns use the exact replacement names/email mappings');
    assert.deepEqual((await page.locator('aside nav a').allTextContents()).map(text => text.trim()), ['Home', 'Entry']);
    assert.equal(await page.getByText('Report Analytics', { exact: true }).count(), 0);
    assert.equal((await fetch(`${base}/api/reports`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
    pass('Analytics page/sidebar/API are removed; old report bookmarks redirect to Entry');
    const search = page.getByRole('searchbox', { name: 'Global master search', exact: true });
    const uiFilters = { year: 2026, type: 'ALL', bd: 'ALL', status: 'ALL', search: '' };
    const expected = async filters => {
      let rows = [], pageNumber = 1, pages = 1;
      do {
        const result = await call(`/distributions?${new URLSearchParams({ ...filters, page: String(pageNumber), limit: '100' })}`);
        rows.push(...result.data); pages = result.pagination.totalPages; pageNumber++;
      } while (pageNumber <= pages);
      const date = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
      return { records: rows, rows: rows.map((row, index) => [index + 1, row.clientName, row.clientMobile, row.clientEmail || '', row.associations.map(link => link.type ?? 'Unassigned').join('\n'), row.associations.map(link => link.bd?.name || '').join('\n'), row.associations.map(link => link.bd?.email || '').join('\n'), date(row.createdAt), Number(filters.year), row.allowedQuantity ?? 1, row.currentYearDistribution?.quantity ?? '', row.currentYearDistribution?.mode ? { COURIER: 'Courier', IN_PERSON: 'In-person' }[row.currentYearDistribution.mode] : '', row.currentYearDistribution?.status ? row.currentYearDistribution.status[0] + row.currentYearDistribution.status.slice(1).toLowerCase() : '', row.isEligible ? 'Not Given' : 'Given', date(row.currentYearDistribution?.distributedAt), row.lastGiven ?? '']) };
    };
    let downloads = 0;
    page.on('download', () => downloads++);
    const change = async (key, value) => {
      uiFilters[key] = value;
      const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/distributions' && Object.entries(uiFilters).every(([key, value]) => (new URL(res.url()).searchParams.get(key) || (key === 'search' ? '' : 'ALL')) === String(value)));
      if (key === 'search') await search.fill(value);
      else await page.getByRole('combobox', { name: { year: 'Year', type: 'Type', bd: 'Requestee Name', status: 'Distribution Status' }[key], exact: true }).selectOption(String(value));
      await response;
      await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Export Excel'); return button && !button.disabled; });
    };
    await change('search', prefix);
    const exportCase = async (label, count) => {
      const wanted = await expected(uiFilters); assert.equal(wanted.rows.length, count);
      const requestedPages = [];
      const listener = request => { const url = new URL(request.url()); if (url.pathname === '/api/distributions' && url.searchParams.get('limit') === '100') requestedPages.push(url.searchParams.get('page')); };
      page.on('request', listener);
      const downloadPromise = page.waitForEvent('download'); await button.click();
      const download = await downloadPromise;
      fs.mkdirSync(output, { recursive: true });
      const workbook = path.join(output, `entry-export-${label}.xlsx`), expectedFile = path.join(output, `entry-export-${label}.json`);
      await download.saveAs(workbook); page.off('request', listener);
      fs.writeFileSync(expectedFile, JSON.stringify({ headings, ...wanted, bds: (await call('/bds')).data, filters: { ...uiFilters } }));
      process.stdout.write(execFileSync('python', [path.join(__dirname, 'check_entry_export.py'), workbook, expectedFile], { encoding: 'utf8' }));
      if (count > 100) assert.deepEqual(requestedPages, ['1', '2']);
    };
    await exportCase('all-pages', 101);
    pass('Four themed sheets export all 101 matching clients across pages, with accurate totals and three native charts');
    await change('vertical', 'Roadshow'); await change('bd', bds[0]._id); await change('status', 'GIVEN');
    await exportCase('filtered', 1);
    await change('year', 2027); await exportCase('year', 1);
    await change('search', `${prefix} no matches`); await exportCase('empty', 0);
    pass('Search, Type, Requestee, year and status filters affect all exported values; empty results retain the themed sheets and valid zero-data charts');
    await page.route('**/api/distributions?**', route => new URL(route.request().url()).searchParams.get('limit') === '100' ? route.abort('connectionrefused') : route.continue());
    await button.click(); await page.getByRole('alert').filter({ hasText: 'Unable to export Excel' }).waitFor();
    assert.equal(downloads, 4); await page.unroute('**/api/distributions?**');
    pass('Failed exports show a clean error and do not download incomplete files');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().right <= 1);
    await page.waitForFunction(() => document.querySelector('main').getBoundingClientRect().left < 30);
    const position = await button.boundingBox(); const heading = await page.getByRole('heading', { name: 'Entry', exact: true }).boundingBox();
    assert.ok(position.x > heading.x && position.x + position.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await snapshot(), phase);
    pass('Export remains at Entry top-right on mobile and never changes database records');
  } finally {
    if (browser) await browser.close();
    const own = (await db.collection('clients').find({ normalizedName: { $regex: `^${prefix.toLowerCase()}` } }).toArray()).map(row => row._id);
    await db.collection('sweetdistributions').deleteMany({ client: { $in: own } });
    await db.collection('clientassociations').deleteMany({ client: { $in: own } });
    await db.collection('clients').deleteMany({ _id: { $in: own } });
    assert.deepEqual(await snapshot(), before);
    await connection.close(); console.log('PASS: Test fixtures removed; original database hashes match.');
  }
  fs.writeFileSync(path.join(output, 'entry-export-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed, dataPreserved: true, success: true }, null, 2));
}
main().catch(error => { console.error('FAIL:', error.stack); process.exitCode = 1; });

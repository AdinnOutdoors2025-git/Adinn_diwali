// Run against the existing backend/database and a running Vite frontend.
// Requires Playwright (or PLAYWRIGHT_MODULE pointing to an installed copy).
// No accounts, clients, BDs or distributions are created or updated.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseURL = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:5173';
const accounts = [
  { role: 'STAFF', email: process.env.AUTH_TEST_STAFF_EMAIL || 'staff@adinn.com', password: process.env.AUTH_TEST_STAFF_PASSWORD || 'Staff@123', destination: '/staff', forbidden: '/cmd' },
  { role: 'CMD', email: process.env.AUTH_TEST_CMD_EMAIL || 'cmd@adinn.com', password: process.env.AUTH_TEST_CMD_PASSWORD || 'Cmd@123', destination: '/cmd', forbidden: '/staff/entry' },
];

async function submit(page, account, password = account.password) {
  await page.getByRole('textbox', { name: 'Username or email', exact: true }).fill(account.email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

async function run() {
  const browser = await chromium.launch({ headless: true, ...(process.env.AUTH_TEST_CHROME ? { executablePath: process.env.AUTH_TEST_CHROME } : { channel: 'chrome' }) });
  let passed = 0;
  async function test(name, action) {
    const context = await browser.newContext();
    try {
      await action(await context.newPage());
      passed++;
      console.log(`PASS: ${name}`);
    } finally {
      await context.close();
    }
  }
  try {
    await test('Vite proxy reaches the ADINN backend', async page => {
      const response = await page.request.get(`${baseURL}/api/health`);
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).service, 'Diwali Sweet Distribution Management API');
    });
    for (const account of accounts) {
      await test(`${account.role}: valid login, redirect, token, session restoration and role restriction`, async page => {
        await page.goto(`${baseURL}/login`);
        const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
        await submit(page, account);
        const response = await responsePromise;
        assert.equal(response.status(), 200);
        const data = await response.json();
        assert.equal(data.success, true);
        assert.equal(data.user.role, account.role);
        assert.equal(response.request().postDataJSON().role, undefined);
        assert.equal(await page.getByRole('tab').count(), 0);
        assert.equal(await page.getByRole('button', { name: /Demo|Staff Login|CMD Login/ }).count(), 0);
        assert.equal(typeof data.token, 'string');
        await page.waitForURL(`${baseURL}${account.destination}`);
        const saved = await page.evaluate(() => ({ token: localStorage.getItem('adinn_diwali_token'), user: JSON.parse(localStorage.getItem('adinn_diwali_user')) }));
        assert.equal(saved.token, data.token);
        assert.equal(saved.user.role, account.role);
        const mePromise = page.waitForResponse(r => r.url().endsWith('/api/auth/me'));
        await page.reload();
        const me = await mePromise;
        assert.equal(me.status(), 200);
        assert.equal((await me.json()).user.role, account.role);
        await page.goto(`${baseURL}/login`);
        await page.waitForURL(`${baseURL}${account.destination}`);
        await page.goto(`${baseURL}${account.forbidden}`);
        await page.waitForURL(`${baseURL}${account.destination}`);
        if (account.role === 'STAFF') {
          await page.goto(`${baseURL}/staff/entry`);
          await page.getByRole('searchbox', { name: 'Global master search', exact: true }).waitFor();
          await page.getByRole('table', { name: 'Client/vendor distribution', exact: true }).waitFor();
        }
      });
      await test(`${account.role}: invalid credentials show a clean error`, async page => {
        await page.goto(`${baseURL}/login`);
        await submit(page, account, 'deliberately-invalid-password');
        await page.getByRole('alert').filter({ hasText: 'Invalid credentials.' }).waitFor();
        assert.equal(new URL(page.url()).pathname, '/login');
        assert.equal(await page.evaluate(() => localStorage.getItem('adinn_diwali_token')), null);
      });

    }
    await test('Unauthenticated users cannot open either portal', async page => {
      for (const destination of ['/staff', '/cmd', '/staff/reports']) {
        await page.goto(`${baseURL}${destination}`);
        await page.waitForURL(`${baseURL}/login`);
      }
    });
    await test('Network failure produces a connection message', async page => {
      await page.goto(`${baseURL}/login`);
      // Transport fault only; successful authentication above always uses the real API.
      await page.route('**/api/auth/login', route => route.abort('connectionrefused'));
      await submit(page, accounts[0]);
      await page.getByRole('alert').filter({ hasText: 'Unable to connect to the server.' }).waitFor();
    });

    const root = path.resolve(__dirname, '..');
    const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
    for (const fault of [
      { name: 'Unavailable backend through Vite', target: 'http://127.0.0.1:1', message: 'Unable to connect to the server.' },
      { name: 'Original HTML 404 from port 5000', target: 'http://127.0.0.1:5000', message: 'Authentication endpoint unavailable.' },
    ]) {
      // Isolated frontend proxies leave the running backend and its database untouched.
      const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: fault.target, changeOrigin: true } } } });
      try {
        await server.listen();
        const faultURL = `http://127.0.0.1:${server.httpServer.address().port}`;
        await test(fault.name, async page => {
          await page.goto(`${faultURL}/login`);
          await submit(page, accounts[0]);
          const alert = page.getByRole('alert').filter({ hasText: fault.message });
          await alert.waitFor();
          assert.doesNotMatch(await alert.innerText(), /<[^>]*>|Cannot POST|stack|Error:/i);
          assert.equal(await page.evaluate(() => localStorage.getItem('adinn_diwali_token')), null);
        });
      } finally {
        await server.close();
      }
    }
    console.log(`${passed} authentication checks passed using the running application.`);
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  // Do not print assertion values: they can contain tokens or user details.
  console.error(`FAIL: authentication smoke test (${error.name}). ${error.name === 'AssertionError' ? 'An assertion did not pass.' : error.message}`);
  process.exitCode = 1;
});

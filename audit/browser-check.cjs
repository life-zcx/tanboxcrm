// Read-only browser checks. API mutations are intercepted and never reach the CRM.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.TEMP, 'tanbox-crm-audit-tools/node_modules/playwright-core'));

async function main() {
  const baseUrl = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3050/';
  const browser = await chromium.launch({
    executablePath: 'C:/Users/admin/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
    headless: true,
  });
  const results = {};
  const context = await browser.newContext();
  const page = await context.newPage();
  const events = [];
  const started = Date.now();
  page.on('pageerror', e => events.push({ type: 'pageerror', message: e.message }));
  page.on('requestfailed', r => events.push({ type: 'requestfailed', url: r.url(), error: r.failure() }));
  page.on('response', r => events.push({ type: 'response', path: new URL(r.url()).pathname, status: r.status(), ms: Date.now() - started }));
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (error) {
    const failure = { baseUrl, ms: Date.now() - started, error: error.message, events };
    fs.writeFileSync(path.join(__dirname, 'browser-localhost-results.json'), JSON.stringify(failure, null, 2));
    console.log(JSON.stringify(failure, null, 2));
    await browser.close();
    return;
  }
  results.freshLoad = { ms: Date.now() - started, events: [...events], loginVisible: await page.getByText('Вход в систему управления').isVisible() };

  // The current input handler captures the previous render's code.
  const sentCodes = [];
  await page.route('**/api/auth/verify-code', route => {
    sentCodes.push(route.request().postDataJSON().code);
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'AUDIT_INTERCEPTED' }) });
  });
  await page.locator('input[inputmode="numeric"]').pressSequentially('123456', { delay: 25 });
  await page.waitForTimeout(300);
  results.loginTyped = { requests: [...sentCodes], validationVisible: await page.getByText('Введите 6-значный проверочный код', { exact: false }).last().isVisible() };
  await page.getByRole('button', { name: 'Войти в TANBOX CRM' }).click();
  await page.waitForTimeout(100);
  results.loginExplicitSubmit = { requests: [...sentCodes] };
  await page.locator('input[inputmode="numeric"]').fill('');
  sentCodes.length = 0;
  await page.locator('input[inputmode="numeric"]').fill('654321');
  await page.waitForTimeout(300);
  results.loginPasted = { requests: [...sentCodes] };
  await context.close();

  const user = { id: 'audit-nonexistent', telegramChatId: 'audit', telegramUsername: 'audit', role: 'ADMIN' };
  const temporary = await browser.newContext();
  await temporary.addInitScript(u => {
    localStorage.setItem('tanbox_crm_token', 'audit-placeholder');
    localStorage.setItem('tanbox_crm_user', JSON.stringify(u));
  }, user);
  const p2 = await temporary.newPage();
  await p2.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary startup failure' }) }));
  await p2.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
  results.temporaryServerFailure = await p2.evaluate(() => ({ tokenRemoved: localStorage.getItem('tanbox_crm_token') === null, showsLogin: document.body.textContent.includes('Вход в систему управления') }));
  await temporary.close();

  const failedData = await browser.newContext();
  await failedData.addInitScript(u => {
    localStorage.setItem('tanbox_crm_token', 'audit-placeholder');
    localStorage.setItem('tanbox_crm_user', JSON.stringify(u));
  }, user);
  const p3 = await failedData.newPage();
  await p3.route('**/api/**', route => route.fulfill({
    status: route.request().url().endsWith('/auth/me') ? 200 : 500,
    contentType: 'application/json',
    body: JSON.stringify(route.request().url().endsWith('/auth/me') ? { user } : { error: 'Database unavailable' }),
  }));
  await p3.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
  results.failedData = await p3.evaluate(() => ({ emptyColumns: (document.body.textContent.match(/Нет сделок на этом этапе/g) || []).length, errorShown: document.body.textContent.includes('Database unavailable') }));
  await failedData.close();

  const missing = await browser.newContext();
  const p4 = await missing.newPage();
  const missingErrors = [];
  p4.on('console', m => { if (m.type() === 'error') missingErrors.push(m.text()); });
  // Simulates stale HTML pointing to an asset removed by the next build.
  await p4.route('**/', async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/\/assets\/index-[^" ]+\.js/g, '/assets/audit-missing-build.js');
    await route.fulfill({ response, body: html });
  });
  await p4.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
  results.missingAsset = { errors: missingErrors, rootChildren: await p4.locator('#root').evaluate(e => e.childElementCount) };
  await missing.close();
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });

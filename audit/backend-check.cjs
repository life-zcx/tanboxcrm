// Isolated controller tests use mocked persistence. Live CRM probes only use GET/HEAD.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.TELEGRAM_BOT_TOKEN = '123456789:audit-placeholder-no-network';
process.env.GOOGLE_GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.JWT_SECRET = 'tanbox-crm-super-secure-jwt-2026';
process.env.ADMIN_API_KEY = 'audit-unused';
const { prisma } = require('../backend/dist/config/db');
const { env } = require('../backend/dist/config/env');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { verifyCode } = require('../backend/dist/modules/auth/auth.controller');
const { telegramBotService } = require('../backend/dist/bot/telegram.bot');
const { aiOrchestrator } = require('../backend/dist/ai/ai.orchestrator');
const { updateClient } = require('../backend/dist/modules/clients/clients.controller');
const results = {};

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const admin = { id: 'audit-admin', telegramChatId: 'audit-chat', telegramUsername: 'audit', role: 'ADMIN' };
async function main() {
  prisma.authCode.findFirst = async () => null;
  prisma.adminUser.upsert = async () => admin;
  let res = response();
  await verifyCode({ body: { code: '777888' } }, res);
  results.masterCodeWithoutOTP = { status: res.statusCode, tokenIssued: !!res.body?.token };
  assert.equal(results.masterCodeWithoutOTP.tokenIssued, true);

  // Two requests pass the initial lookup before either consumes the same code.
  prisma.authCode.findFirst = async () => ({ id: 'audit-code', telegramChatId: 'audit-chat', isUsed: false });
  prisma.authCode.update = async () => ({});
  prisma.adminUser.findUnique = async () => admin;
  prisma.adminUser.update = async () => admin;
  const attempts = [response(), response()];
  await Promise.all(attempts.map(r => verifyCode({ body: { code: '123456' } }, r)));
  results.concurrentCodeReuse = { issuedTokens: attempts.filter(r => r.body?.token).length };

  // Telegram processing is entirely local: replace its transport and persistence.
  const bot = telegramBotService.bot;
  bot.botInfo = { id: 123456789, is_bot: true, first_name: 'Audit', username: 'audit_bot' };
  const replies = [];
  // Telegraf makes a new Telegram instance per update; stub the prototype.
  const { Telegram } = require('../backend/node_modules/telegraf');
  Telegram.prototype.callApi = async (method, payload) => {
    replies.push({ method, containsOTP: /\d{6}/.test(payload.text || '') });
    return { message_id: 1, date: 0, chat: { id: 999999, type: 'private' } };
  };
  let createdRole;
  prisma.authCode.create = async () => ({});
  prisma.adminUser.upsert = async args => { createdRole = args.create.role; return admin; };
  await bot.handleUpdate({ update_id: 1, message: {
    message_id: 1, date: 0, from: { id: 999999, is_bot: false, first_name: 'Unapproved' },
    chat: { id: 999999, type: 'private' }, text: '/login', entities: [{ offset: 0, length: 6, type: 'bot_command' }],
  } });
  results.unapprovedTelegramLogin = { roleCreated: createdRole, otpSent: replies.some(r => r.containsOTP) };

  // Arbitrary signed identity can read CRM endpoints even though /me rejects it.
  const token = jwt.sign({ id: 'audit-user-does-not-exist', role: 'ADMIN', telegramChatId: 'audit' }, env.JWT_SECRET, { expiresIn: '1m' });
  const headers = { Authorization: `Bearer ${token}` };
  const summary = await fetch('http://127.0.0.1:3050/api/clients/stats/summary', { headers });
  const me = await fetch('http://127.0.0.1:3050/api/auth/me', { headers });
  results.forgedJWTLiveReadOnly = { crmStatus: summary.status, meStatus: me.status };
  await summary.arrayBuffer();
  await me.arrayBuffer();
  const imageName = fs.readdirSync(path.join(__dirname, '../backend/uploads')).find(x => x.endsWith('.jpg'));
  const imageResponse = await fetch(`http://127.0.0.1:3050/uploads/${imageName}`, { method: 'HEAD' });
  results.screenshotWithoutAuthentication = { status: imageResponse.status, type: imageResponse.headers.get('content-type') };

  // Upload test writes only to an OS temporary directory; no AI calls.
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tanbox-upload-audit-'));
  env.UPLOADS_DIR = temporaryDirectory;
  const express = require('../backend/node_modules/express');
  const { uploadScreenshots } = require('../backend/dist/middleware/upload.middleware');
  const app = express();
  app.post('/upload', uploadScreenshots, (req, res) => res.json({ filename: req.files[0].filename }));
  app.use('/uploads', express.static(temporaryDirectory));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const form = new FormData();
    form.append('screenshots', new Blob(['<!doctype html><script>document.documentElement.dataset.audit="executed"</script>'], { type: 'image/png' }), 'inert-audit.html');
    const accepted = await fetch(`${origin}/upload`, { method: 'POST', body: form });
    const uploaded = await accepted.json();
    const served = await fetch(`${origin}/uploads/${uploaded.filename}`);
    results.htmlAcceptedAsImage = { status: accepted.status, extension: path.extname(uploaded.filename), servedType: served.headers.get('content-type') };
    await served.arrayBuffer();
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  // No provider/network calls: use the disabled provider's existing fallback.
  let clientCreates = 0, dealCreates = 0;
  prisma.client.create = async args => ({ id: `audit-${++clientCreates}`, ...args.data });
  prisma.conversationChunk.create = async () => ({ id: 'audit-chunk', messages: [] });
  prisma.deal.create = async () => { dealCreates++; return {}; };
  await aiOrchestrator.ingestTextDialogue({ rawText: 'Audit text' });
  results.ingestWithoutDeal = { clientsCreated: clientCreates, dealsCreated: dealCreates };

  let updateArguments;
  prisma.client.update = async args => { updateArguments = args; return { id: 'audit-client' }; };
  await updateClient({ params: { id: 'audit-client' }, body: { id: 'replacement-id', deals: { deleteMany: {} } } }, response());
  results.unrestrictedClientUpdate = { idChangeForwarded: updateArguments.data.id === 'replacement-id', nestedDeleteForwarded: !!updateArguments.data.deals?.deleteMany };

  const batchService = new (require('../backend/dist/bot/telegram.bot').TelegramBotService)();
  batchService.processPendingBatch = async () => {};
  const fakeContext = { chat: { id: 999999 }, from: { id: 999999, first_name: 'Audit' }, reply: async () => ({ message_id: 1 }) };
  await Promise.all([batchService.enqueueImage(fakeContext, 'first', 'image/jpeg'), batchService.enqueueImage(fakeContext, 'second', 'image/jpeg')]);
  const batch = batchService.pendingBatches.get(999999);
  results.concurrentTelegramImages = { inputImages: 2, retainedImages: batch.images.length };
  clearTimeout(batch.timer);
  batchService.pendingBatches.clear();

  fs.writeFileSync(path.join(__dirname, 'backend-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exitCode = 1; });

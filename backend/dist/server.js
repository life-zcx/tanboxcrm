"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_dns_1 = __importDefault(require("node:dns"));
node_dns_1.default.setDefaultResultOrder('ipv4first');
require("./lib/system-logger");
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const app_1 = require("./app");
const telegram_bot_1 = require("./bot/telegram.bot");
const whatsapp_service_1 = require("./whatsapp/whatsapp.service");
const screenshot_drafts_service_1 = require("./bot/screenshot-drafts.service");
const client_deletion_service_1 = require("./modules/clients/client-deletion.service");
const web_service_1 = require("./knowledge/web.service");
async function main() {
    await db_1.prisma.$connect();
    const server = (0, app_1.createApp)().listen(env_1.env.PORT, env_1.env.HOST, () => {
        console.log('TANBOX CRM API ready on port', env_1.env.PORT);
        void telegram_bot_1.telegramBotService.start();
        void whatsapp_service_1.whatsappService.autoStartIfSaved();
    });
    server.requestTimeout = 70000;
    let stopping = false;
    const cleanup = setInterval(() => {
        void db_1.prisma.$transaction([
            db_1.prisma.authCode.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
            db_1.prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        ]).catch(() => console.warn('Session cleanup failed'));
    }, 60000);
    const fileCleanup = setInterval(() => void (0, client_deletion_service_1.flushFileDeletions)().catch(() => console.warn('File cleanup postponed')), 30000);
    const draftCleanup = setInterval(() => void (0, screenshot_drafts_service_1.cleanupExpiredScreenshotDrafts)().catch(() => console.warn('Draft cleanup postponed')), 60000);
    fileCleanup.unref();
    draftCleanup.unref();
    void (0, client_deletion_service_1.flushFileDeletions)().catch(() => console.warn('File cleanup postponed'));
    void (0, screenshot_drafts_service_1.cleanupExpiredScreenshotDrafts)().catch(() => console.warn('Draft cleanup postponed'));
    cleanup.unref();
    const knowledgeTimer = env_1.env.KNOWLEDGE_AUTO_COLLECT ? setInterval(() => void (0, web_service_1.collectDue)(5).catch(() => console.warn('Knowledge monitoring postponed')), 60000) : undefined;
    knowledgeTimer?.unref();
    if (env_1.env.KNOWLEDGE_AUTO_COLLECT)
        void (0, web_service_1.seedWebRegistry)().then(() => (0, web_service_1.collectDue)(3)).catch(() => console.warn('Knowledge registry initialization postponed'));
    const stop = async () => {
        if (stopping)
            return;
        stopping = true;
        clearInterval(cleanup);
        clearInterval(fileCleanup);
        clearInterval(draftCleanup);
        if (knowledgeTimer)
            clearInterval(knowledgeTimer);
        const deadline = setTimeout(() => process.exit(1), 15000);
        deadline.unref();
        await telegram_bot_1.telegramBotService.stop().catch(() => { });
        await whatsapp_service_1.whatsappService.stop().catch(() => { });
        await new Promise(resolve => server.close(() => resolve()));
        await db_1.prisma.$disconnect();
        clearTimeout(deadline);
    };
    process.once('SIGTERM', () => void stop());
    process.once('SIGINT', () => void stop());
}
main().catch(() => { console.error('CRM startup failed: check database and required configuration'); process.exitCode = 1; });

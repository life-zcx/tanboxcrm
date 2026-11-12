"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.discardScreenshotDraft = discardScreenshotDraft;
exports.cleanupExpiredScreenshotDrafts = cleanupExpiredScreenshotDrafts;
exports.createTelegramScreenshotDraft = createTelegramScreenshotDraft;
exports.getTelegramScreenshotDraft = getTelegramScreenshotDraft;
exports.updateTelegramScreenshotDraft = updateTelegramScreenshotDraft;
exports.commitTelegramScreenshotDraft = commitTelegramScreenshotDraft;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const ai_orchestrator_1 = require("../ai/ai.orchestrator");
const gemini_service_1 = require("../ai/gemini.service");
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const errors_1 = require("../lib/errors");
const files_1 = require("../lib/files");
const draftLifetimeMs = 30 * 60 * 1000;
async function removeDraftImages(urls) {
    for (const url of urls) {
        const filename = (0, files_1.imageFilename)(url);
        if (!filename)
            continue;
        const used = await db_1.prisma.conversationChunk.findFirst({ where: { screenshotUrl: { contains: url } }, select: { id: true } });
        if (!used)
            await (0, files_1.deleteImages)([url]);
    }
}
async function discardScreenshotDraft(id, userId) {
    const draft = await db_1.prisma.screenshotDraft.findFirst({ where: { id, ...(userId ? { telegramUserId: userId } : {}) } });
    if (!draft)
        return false;
    await db_1.prisma.screenshotDraft.deleteMany({ where: { id: draft.id } });
    await removeDraftImages(draft.imageUrls);
    return true;
}
async function cleanupExpiredScreenshotDrafts() {
    const expired = await db_1.prisma.screenshotDraft.findMany({ where: { expiresAt: { lte: new Date() } }, select: { id: true }, take: 25 });
    for (const draft of expired)
        await discardScreenshotDraft(draft.id);
    return expired.length;
}
async function createTelegramScreenshotDraft(userId, images, parsed, reviewToken, targetClientId) {
    const previous = await db_1.prisma.screenshotDraft.findMany({ where: { telegramUserId: userId }, select: { id: true } });
    for (const draft of previous)
        await discardScreenshotDraft(draft.id, userId);
    return db_1.prisma.screenshotDraft.create({ data: {
            telegramUserId: userId, targetClientId, imageUrls: images.map(image => image.url),
            parsed: JSON.parse(JSON.stringify(parsed)), reviewToken,
            expiresAt: new Date(Date.now() + draftLifetimeMs),
        } });
}
async function getTelegramScreenshotDraft(id, userId) {
    const draft = await db_1.prisma.screenshotDraft.findFirst({ where: { id, telegramUserId: userId, expiresAt: { gt: new Date() } } });
    if (!draft)
        throw new errors_1.AppError(404, 'Черновик не найден или срок проверки истёк. Загрузите скриншоты снова.');
    return draft;
}
async function updateTelegramScreenshotDraft(id, userId, update) {
    const draft = await getTelegramScreenshotDraft(id, userId);
    const parsed = gemini_service_1.parsedConversationSchema.parse(update(gemini_service_1.parsedConversationSchema.parse(draft.parsed)));
    const result = await db_1.prisma.screenshotDraft.updateMany({ where: { id, telegramUserId: userId, expiresAt: { gt: new Date() } }, data: { parsed: JSON.parse(JSON.stringify(parsed)) } });
    if (!result.count)
        throw new errors_1.AppError(404, 'Срок проверки истёк. Загрузите скриншоты снова.');
    return parsed;
}
async function commitTelegramScreenshotDraft(id, userId) {
    const draft = await getTelegramScreenshotDraft(id, userId);
    const images = await Promise.all(draft.imageUrls.map(async (url) => {
        const filename = (0, files_1.imageFilename)(url);
        if (!filename)
            throw new errors_1.AppError(400, 'Недопустимый путь к скриншоту');
        try {
            return { buffer: await promises_1.default.readFile(node_path_1.default.join(env_1.env.UPLOADS_DIR, filename)), mimeType: 'image/jpeg', url };
        }
        catch {
            throw new errors_1.AppError(404, 'Скриншот черновика не найден. Загрузите его снова.');
        }
    }));
    const result = await ai_orchestrator_1.aiOrchestrator.commitReviewedScreenshots({ images, targetClientId: draft.targetClientId || undefined, reviewToken: draft.reviewToken, parsed: draft.parsed, source: 'TELEGRAM_BOT' });
    await discardScreenshotDraft(id, userId);
    return result;
}

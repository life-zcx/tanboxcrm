"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChunkMessages = exports.getClientConversations = exports.addManualMessagesHandler = exports.ingestTextDialogueHandler = exports.commitScreenshotHandler = exports.previewScreenshotHandler = void 0;
const zod_1 = require("zod");
const node_crypto_1 = require("node:crypto");
const ai_orchestrator_1 = require("../../ai/ai.orchestrator");
const ai_orchestrator_2 = require("../../ai/ai.orchestrator");
const db_1 = require("../../config/db");
const errors_1 = require("../../lib/errors");
const validation_1 = require("../../lib/validation");
const files_1 = require("../../lib/files");
exports.previewScreenshotHandler = (0, errors_1.route)(async (req, res) => {
    const { targetClientId } = zod_1.z.object({ targetClientId: validation_1.idSchema.optional() }).strict().parse(req.body);
    const files = req.files || [];
    const images = await (0, files_1.prepareImages)(files.map(f => ({ buffer: f.buffer, mimeType: f.mimetype })));
    try {
        const preview = await ai_orchestrator_1.aiOrchestrator.previewScreenshots({ images, targetClientId });
        res.json(preview);
    }
    finally {
        await (0, files_1.deleteImages)(images.map(i => i.url));
    }
});
exports.commitScreenshotHandler = (0, errors_1.route)(async (req, res) => {
    const { targetClientId, reviewToken, parsed } = zod_1.z.object({ targetClientId: validation_1.idSchema.optional(), reviewToken: zod_1.z.string().min(1).max(100), parsed: zod_1.z.string().min(1).max(3_100_000) }).strict().parse(req.body);
    let parsedValue;
    try {
        parsedValue = JSON.parse(parsed);
    }
    catch {
        throw new errors_1.AppError(400, 'Некорректные данные переписки');
    }
    const files = req.files || [];
    const images = await (0, files_1.prepareImages)(files.map(f => ({ buffer: f.buffer, mimeType: f.mimetype })));
    try {
        const result = await ai_orchestrator_1.aiOrchestrator.commitReviewedScreenshots({ images, targetClientId, reviewToken, parsed: parsedValue });
        if (result.duplicate)
            await (0, files_1.deleteImages)(images.map(i => i.url));
        res.status(result.duplicate ? 200 : 201).json({ result });
    }
    catch (error) {
        await (0, files_1.deleteImages)(images.map(i => i.url));
        throw error;
    }
});
exports.ingestTextDialogueHandler = (0, errors_1.route)(async (req, res) => {
    const { rawText, targetClientId } = zod_1.z.object({ rawText: (0, validation_1.text)(50000), targetClientId: validation_1.idSchema.optional() }).strict().parse(req.body);
    const result = await ai_orchestrator_1.aiOrchestrator.ingestTextDialogue({ rawText, targetClientId, source: 'WEB_PANEL' });
    res.status(result.duplicate ? 200 : 201).json({ result });
});
const manualMessagesSchema = zod_1.z.object({
    requestId: validation_1.idSchema,
    channel: zod_1.z.enum(['WHATSAPP', 'TELEGRAM', 'OTHER']),
    note: zod_1.z.string().trim().max(500).optional(),
    messages: zod_1.z.array(zod_1.z.object({
        sender: zod_1.z.enum(['CLIENT', 'MANAGER']),
        content: zod_1.z.string().trim().min(1).max(4000),
        time: zod_1.z.iso.datetime({ offset: true }).optional(),
    }).strict()).min(1).max(100),
}).strict().refine(value => value.messages.reduce((size, message) => size + message.content.length, 0) <= 200000, { message: 'Слишком большой объём текста' });
exports.addManualMessagesHandler = (0, errors_1.route)(async (req, res) => {
    const clientId = validation_1.idSchema.parse(req.params.clientId), input = manualMessagesSchema.parse(req.body);
    const fingerprint = (0, node_crypto_1.createHash)('sha256').update('MANUAL_ENTRY:' + clientId + ':' + input.requestId).digest('hex');
    const existing = await db_1.prisma.conversationChunk.findUnique({ where: { fingerprint }, include: { messages: { orderBy: { position: 'asc' } }, _count: { select: { messages: true } } } });
    if (existing) {
        res.json({ chunk: existing, duplicate: true });
        return;
    }
    try {
        const chunk = await db_1.prisma.$transaction(async (tx) => {
            const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true } });
            if (!client)
                throw new errors_1.AppError(404, 'Клиент не найден');
            const saved = await tx.conversationChunk.create({ data: {
                    clientId, channel: input.channel, source: 'MANUAL_ENTRY', fingerprint,
                    summary: input.note || 'Сообщения добавлены вручную',
                    messages: { create: input.messages.map((message, position) => ({ sender: message.sender, content: message.content, position, timestamp: (0, ai_orchestrator_2.knownTimestamp)(message.time), originalTime: message.time || null })) },
                }, include: { messages: { orderBy: { position: 'asc' } }, _count: { select: { messages: true } } } });
            await tx.client.update({ where: { id: clientId }, data: { lastContactAt: new Date() } });
            return saved;
        });
        res.status(201).json({ chunk, duplicate: false });
    }
    catch (error) {
        if (error?.code === 'P2002') {
            const duplicate = await db_1.prisma.conversationChunk.findUnique({ where: { fingerprint }, include: { messages: { orderBy: { position: 'asc' } }, _count: { select: { messages: true } } } });
            if (duplicate) {
                res.json({ chunk: duplicate, duplicate: true });
                return;
            }
        }
        throw error;
    }
});
exports.getClientConversations = (0, errors_1.route)(async (req, res) => {
    const clientId = validation_1.idSchema.parse(req.params.clientId), { skip, take } = (0, validation_1.pagination)(req.query, 20);
    const [conversations, total] = await db_1.prisma.$transaction([
        db_1.prisma.conversationChunk.findMany({ where: { clientId }, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { messages: { orderBy: [{ position: 'desc' }, { id: 'desc' }], take: 100 }, _count: { select: { messages: true } } } }),
        db_1.prisma.conversationChunk.count({ where: { clientId } }),
    ]);
    conversations.forEach(c => c.messages.reverse());
    res.json({ conversations, total, offset: skip, limit: take });
});
exports.getChunkMessages = (0, errors_1.route)(async (req, res) => {
    const chunkId = validation_1.idSchema.parse(req.params.chunkId), { skip, take } = (0, validation_1.pagination)(req.query, 100);
    const [messages, total] = await db_1.prisma.$transaction([
        db_1.prisma.message.findMany({ where: { chunkId }, skip, take, orderBy: [{ position: 'desc' }, { id: 'desc' }] }),
        db_1.prisma.message.count({ where: { chunkId } }),
    ]);
    res.json({ messages: messages.reverse(), total });
});

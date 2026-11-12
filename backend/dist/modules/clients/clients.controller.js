"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatsSummary = exports.deleteClient = exports.updateClient = exports.createClient = exports.getClientById = exports.getClients = void 0;
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const errors_1 = require("../../lib/errors");
const validation_1 = require("../../lib/validation");
const client_deletion_service_1 = require("./client-deletion.service");
exports.getClients = (0, errors_1.route)(async (req, res) => {
    const { skip, take } = (0, validation_1.pagination)(req.query);
    const where = {};
    if (req.query.status && req.query.status !== 'ALL')
        where.status = zod_1.z.enum(validation_1.clientStatuses).parse(req.query.status);
    if (req.query.category && req.query.category !== 'ALL')
        where.category = zod_1.z.enum(validation_1.categories).parse(req.query.category);
    if (req.query.search) {
        const search = zod_1.z.string().max(200).parse(req.query.search);
        where.OR = ['name', 'phone', 'company', 'binIin'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } }));
    }
    const [clients, total] = await db_1.prisma.$transaction([
        db_1.prisma.client.findMany({ where, skip, take, orderBy: req.query.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ lastContactAt: 'desc' }, { id: 'asc' }], include: { _count: { select: { conversations: true, deals: true, aiSuggestions: true } } } }),
        db_1.prisma.client.count({ where }),
    ]);
    res.json({ clients, total, offset: skip, limit: take });
});
exports.getClientById = (0, errors_1.route)(async (req, res) => {
    const id = validation_1.idSchema.parse(req.params.id);
    const client = await db_1.prisma.client.findUnique({ where: { id }, include: {
            conversations: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20, include: { messages: { orderBy: [{ position: 'desc' }, { id: 'desc' }], take: 100 }, _count: { select: { messages: true } } } },
            deals: { orderBy: { createdAt: 'desc' }, take: 50 }, aiSuggestions: { orderBy: { createdAt: 'desc' }, take: 10 },
            _count: { select: { conversations: true } },
        } });
    if (!client)
        throw new errors_1.AppError(404, 'Клиент не найден');
    client.conversations.forEach(c => c.messages.reverse());
    res.json({ client });
});
exports.createClient = (0, errors_1.route)(async (req, res) => {
    const data = validation_1.clientInput.extend({ name: zod_1.z.string().trim().min(1).max(200) }).parse(req.body);
    const client = await db_1.prisma.$transaction(async (tx) => {
        const client = await tx.client.create({ data: { ...data, status: data.status || 'LEAD' } });
        await tx.deal.create({ data: { clientId: client.id, title: 'Заказ: ' + client.name, stage: validation_1.statusToStage[client.status], amount: client.estimatedAmount, codesCount: client.estimatedVolume } });
        return client;
    });
    res.status(201).json({ client });
});
exports.updateClient = (0, errors_1.route)(async (req, res) => {
    const id = validation_1.idSchema.parse(req.params.id), data = validation_1.clientInput.parse(req.body);
    if (!Object.keys(data).length)
        throw new errors_1.AppError(400, 'Нет полей для изменения');
    const client = await db_1.prisma.$transaction(async (tx) => {
        const client = await tx.client.update({ where: { id }, data });
        // A client-level status is an explicit update of its current order.
        if (data.status) {
            const deal = await tx.deal.findFirst({ where: { clientId: id }, orderBy: { updatedAt: 'desc' } });
            if (deal)
                await tx.deal.update({ where: { id: deal.id }, data: { stage: validation_1.statusToStage[data.status] } });
        }
        return client;
    });
    res.json({ client });
});
exports.deleteClient = (0, errors_1.route)(async (req, res) => {
    const id = validation_1.idSchema.parse(req.params.id);
    const result = await (0, client_deletion_service_1.deleteClientCompletely)(id);
    res.status(result.cleanupPending ? 202 : 200).json(result);
});
exports.getStatsSummary = (0, errors_1.route)(async (_req, res) => {
    const [totalClients, totalConversations, totalAiSuggestions, groups] = await db_1.prisma.$transaction([
        db_1.prisma.client.count(), db_1.prisma.conversationChunk.count(), db_1.prisma.aISuggestion.count(), db_1.prisma.client.groupBy({ by: ['status'], orderBy: { status: 'asc' }, _count: true }),
    ]);
    res.json({ totalClients, totalConversations, totalAiSuggestions, funnel: Object.fromEntries(groups.map(g => [g.status, g._count])) });
});

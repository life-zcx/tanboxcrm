"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateDealStage = exports.createDeal = exports.getDeals = void 0;
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const errors_1 = require("../../lib/errors");
const validation_1 = require("../../lib/validation");
const dealInput = zod_1.z.object({
    stage: zod_1.z.enum(validation_1.dealStages).optional(),
    amount: validation_1.numberField,
    codesCount: zod_1.z.number().int().nonnegative().max(1e9).nullable().optional(),
    lossReason: zod_1.z.string().trim().max(500).optional(),
}).strict();
exports.getDeals = (0, errors_1.route)(async (req, res) => {
    const { skip, take } = (0, validation_1.pagination)(req.query);
    const stage = req.query.stage ? zod_1.z.enum(validation_1.dealStages).parse(req.query.stage) : undefined;
    const where = { stage };
    const [deals, total, amount] = await db_1.prisma.$transaction([
        db_1.prisma.deal.findMany({ where, skip, take, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], include: { client: true } }), db_1.prisma.deal.count({ where }), db_1.prisma.deal.aggregate({ where, _sum: { amount: true } }),
    ]);
    res.json({ deals, total, offset: skip, limit: take, amountTotal: amount._sum.amount || 0 });
});
exports.createDeal = (0, errors_1.route)(async (req, res) => {
    const input = dealInput.extend({ clientId: validation_1.idSchema, title: (0, validation_1.text)(300), services: zod_1.z.array((0, validation_1.text)(200)).max(30).optional() }).parse(req.body);
    const deal = await db_1.prisma.$transaction(async (tx) => {
        const deal = await tx.deal.create({ data: { ...input, services: input.services ? JSON.stringify(input.services) : null }, include: { client: true } });
        await tx.client.update({ where: { id: deal.clientId }, data: { status: validation_1.stageToStatus[deal.stage] } });
        return deal;
    });
    res.status(201).json({ deal });
});
exports.updateDealStage = (0, errors_1.route)(async (req, res) => {
    const id = validation_1.idSchema.parse(req.params.id), data = dealInput.parse(req.body);
    const { lossReason, ...dealData } = data;
    const deal = await db_1.prisma.$transaction(async (tx) => {
        const deal = await tx.deal.update({ where: { id }, data: dealData });
        if (dealData.stage) {
            const clientUpdate = { status: validation_1.stageToStatus[dealData.stage] };
            if (dealData.stage === 'CLOSED_LOST' && lossReason) {
                clientUpdate.aiObjections = lossReason;
                const currentClient = await tx.client.findUnique({ where: { id: deal.clientId }, select: { notes: true } });
                const existingNotes = currentClient?.notes ? `${currentClient.notes}\n` : '';
                clientUpdate.notes = `${existingNotes}[Причина отказа: ${lossReason}]`;
            }
            await tx.client.update({ where: { id: deal.clientId }, data: clientUpdate });
        }
        return tx.deal.findUniqueOrThrow({ where: { id }, include: { client: true } });
    });
    res.json({ deal });
});

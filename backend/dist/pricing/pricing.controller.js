"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeQuote = exports.listQuotes = exports.createQuote = exports.getPricing = void 0;
const zod_1 = require("zod");
const db_1 = require("../config/db");
const errors_1 = require("../lib/errors");
const validation_1 = require("../lib/validation");
const pricing_service_1 = require("./pricing.service");
exports.getPricing = (0, errors_1.route)(async (_req, res) => { res.json({ snapshot: await (0, pricing_service_1.loadPricing)(), policy: { minimumProBatch: 500, source: 'Прайс TANBOX от 06.11.2026', sourceSha256: '7b9f6ed010e07b4f5e91f014d16d7fcb559098fe97778e4ab1f9c35ca8753f8a' } }); });
exports.createQuote = (0, errors_1.route)(async (req, res) => {
    const { clientId, input } = zod_1.z.object({ clientId: validation_1.idSchema, input: zod_1.z.unknown() }).strict().parse(req.body);
    res.status(201).json({ quote: await (0, pricing_service_1.saveQuote)(clientId, input) });
});
exports.listQuotes = (0, errors_1.route)(async (req, res) => {
    const clientId = validation_1.idSchema.parse(req.query.clientId), { skip, take } = (0, validation_1.pagination)(req.query, 20);
    if (!await db_1.prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))
        throw new errors_1.AppError(404, 'Клиент не найден');
    const [quotes, total] = await db_1.prisma.$transaction([db_1.prisma.commercialQuote.findMany({ where: { clientId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }), db_1.prisma.commercialQuote.count({ where: { clientId } })]);
    res.json({ quotes, total, offset: skip, limit: take });
});
exports.revokeQuote = (0, errors_1.route)(async (req, res) => {
    const id = validation_1.idSchema.parse(req.params.id);
    zod_1.z.object({}).strict().parse(req.body);
    const updated = await db_1.prisma.commercialQuote.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!updated.count && !await db_1.prisma.commercialQuote.findUnique({ where: { id }, select: { id: true } }))
        throw new errors_1.AppError(404, 'Расчёт не найден');
    res.json({ success: true });
});

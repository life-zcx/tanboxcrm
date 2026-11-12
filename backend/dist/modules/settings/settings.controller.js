"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteKnowledgeItem = exports.createKnowledgeItem = exports.getKnowledgeBase = void 0;
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const knowledge_service_1 = require("../../ai/knowledge.service");
const errors_1 = require("../../lib/errors");
const validation_1 = require("../../lib/validation");
exports.getKnowledgeBase = (0, errors_1.route)(async (req, res) => {
    const { skip, take } = (0, validation_1.pagination)(req.query);
    const [items, total] = await db_1.prisma.$transaction([db_1.prisma.knowledgeItem.findMany({ skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }), db_1.prisma.knowledgeItem.count()]);
    res.json({ hardcodedKnowledge: knowledge_service_1.TANBOX_KNOWLEDGE, customKnowledgeItems: items, total, offset: skip, limit: take });
});
exports.createKnowledgeItem = (0, errors_1.route)(async (req, res) => {
    const data = zod_1.z.object({ category: zod_1.z.enum(['TARIFFS', 'IS_MPT_RULES', 'OBJECTIONS', 'STICKERING', 'FAQ']).default('FAQ'), title: (0, validation_1.text)(200), content: (0, validation_1.text)(10000), reviewStatus: zod_1.z.enum(['DRAFT', 'APPROVED']).default('DRAFT') }).strict().parse(req.body);
    const item = await db_1.prisma.knowledgeItem.create({ data: { ...data, reviewStatus: data.category === 'IS_MPT_RULES' ? 'DRAFT' : data.reviewStatus } });
    res.status(201).json({ item });
});
exports.deleteKnowledgeItem = (0, errors_1.route)(async (req, res) => { await db_1.prisma.knowledgeItem.delete({ where: { id: validation_1.idSchema.parse(req.params.id) } }); res.json({ success: true }); });

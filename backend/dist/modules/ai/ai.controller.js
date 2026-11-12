"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviseDraft = exports.getDraftChat = exports.suggestReply = exports.getAIStatus = void 0;
const zod_1 = require("zod");
const ai_orchestrator_1 = require("../../ai/ai.orchestrator");
const telegram_bot_1 = require("../../bot/telegram.bot");
const knowledge_service_1 = require("../../ai/knowledge.service");
const errors_1 = require("../../lib/errors");
const validation_1 = require("../../lib/validation");
const pricing_service_1 = require("../../pricing/pricing.service");
exports.getAIStatus = (0, errors_1.route)(async (_req, res) => {
    res.json({
        providers: ai_orchestrator_1.aiOrchestrator.getProvidersStatus(),
        telegramBot: telegram_bot_1.telegramBotService.getStatus(),
        knowledgeBase: { ...await (0, pricing_service_1.pricingAvailability)(), categoriesCount: knowledge_service_1.TANBOX_KNOWLEDGE.categories.length, jurisdiction: knowledge_service_1.TANBOX_KNOWLEDGE.jurisdiction, retrievalEnabled: true },
    });
});
exports.suggestReply = (0, errors_1.route)(async (req, res) => {
    const options = zod_1.z.object({ clientId: validation_1.idSchema, quoteId: validation_1.idSchema.optional(), userPrompt: (0, validation_1.text)(3000).optional(), provider: zod_1.z.enum(['GEMINI', 'OPENAI', 'AUTO']).optional(), style: zod_1.z.enum(['BUSINESS', 'FRIENDLY', 'CLOSING', 'EXPERT']).optional(), intent: zod_1.z.enum(['REPLY', 'COMMERCIAL_OFFER']).optional() }).strict().parse(req.body);
    res.json({ suggestion: await ai_orchestrator_1.aiOrchestrator.generateSuggestedReply(options) });
});
exports.getDraftChat = (0, errors_1.route)(async (req, res) => {
    const query = zod_1.z.object({ clientId: validation_1.idSchema, intent: zod_1.z.enum(['REPLY', 'COMMERCIAL_OFFER']) }).strict().parse(req.query);
    res.json({ entries: await ai_orchestrator_1.aiOrchestrator.listDraftChat(query.clientId, query.intent) });
});
exports.reviseDraft = (0, errors_1.route)(async (req, res) => {
    const options = zod_1.z.object({ clientId: validation_1.idSchema, suggestionId: validation_1.idSchema, instruction: (0, validation_1.text)(3000), style: zod_1.z.enum(['BUSINESS', 'FRIENDLY', 'CLOSING', 'EXPERT']).optional() }).strict().parse(req.body);
    res.json({ suggestion: await ai_orchestrator_1.aiOrchestrator.reviseDraft(options) });
});

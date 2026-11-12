"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const errors_1 = require("../lib/errors");
const whatsapp_service_1 = require("./whatsapp.service");
const system_logger_1 = require("../lib/system-logger");
const router = (0, express_1.Router)();
router.get('/status', (0, errors_1.route)(async (_req, res) => {
    res.json(whatsapp_service_1.whatsappService.getStatus());
}));
router.post('/connect', (0, errors_1.route)(async (_req, res) => {
    void whatsapp_service_1.whatsappService.start();
    res.json({ ok: true, notice: 'Подключение инициировано' });
}));
router.post('/logout', (0, errors_1.route)(async (_req, res) => {
    await whatsapp_service_1.whatsappService.logout();
    res.json({ ok: true, notice: 'Сессия WhatsApp завершена' });
}));
router.post('/restart', (0, errors_1.route)(async (_req, res) => {
    await whatsapp_service_1.whatsappService.restart();
    res.json({ ok: true, notice: 'Перезапуск WhatsApp' });
}));
router.post('/sync', (0, errors_1.route)(async (_req, res) => {
    const result = await whatsapp_service_1.whatsappService.triggerHistorySync();
    res.json(result);
}));
router.get('/feed', (0, errors_1.route)(async (_req, res) => {
    res.json(whatsapp_service_1.whatsappService.getFeed());
}));
router.post('/settings', (0, errors_1.route)(async (req, res) => {
    const schema = zod_1.z.object({
        autoCreateLeads: zod_1.z.boolean().optional(),
        autoRunAi: zod_1.z.boolean().optional(),
    }).strict();
    const parsed = schema.parse(req.body);
    const updated = whatsapp_service_1.whatsappService.updateSettings(parsed);
    res.json({ ok: true, settings: updated });
}));
router.get('/logs', (0, errors_1.route)(async (req, res) => {
    const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 200));
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const logs = system_logger_1.systemLogger.getLogs(limit, filter, level);
    res.json({ logs });
}));
router.post('/logs/clear', (0, errors_1.route)(async (_req, res) => {
    system_logger_1.systemLogger.clear();
    res.json({ ok: true, logs: system_logger_1.systemLogger.getLogs() });
}));
exports.default = router;

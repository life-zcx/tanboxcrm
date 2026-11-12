"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const errors_1 = require("../../lib/errors");
const system_logger_1 = require("../../lib/system-logger");
const router = (0, express_1.Router)();
router.get('/', (0, errors_1.route)(async (req, res) => {
    const limit = Math.min(2000, Math.max(10, Number(req.query.limit) || 500));
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const logs = system_logger_1.systemLogger.getLogs(limit, category, level, search);
    res.json({ logs });
}));
router.post('/frontend', (0, errors_1.route)(async (req, res) => {
    const schema = zod_1.z.object({
        level: zod_1.z.enum(['INFO', 'WARN', 'ERROR']).default('INFO'),
        message: zod_1.z.string().trim().min(1).max(2000),
        details: zod_1.z.any().optional(),
    });
    const parsed = schema.parse(req.body);
    system_logger_1.systemLogger.log('FRONTEND', parsed.level, parsed.message, parsed.details);
    res.json({ ok: true });
}));
router.post('/clear', (0, errors_1.route)(async (_req, res) => {
    system_logger_1.systemLogger.clear();
    res.json({ ok: true, logs: system_logger_1.systemLogger.getLogs(10) });
}));
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const errors_1 = require("../../lib/errors");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const access_service_1 = require("./access.service");
const telegram_bot_1 = require("../../bot/telegram.bot");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.requireAuth, (0, errors_1.route)(async (req, _res, next) => {
    if (!req.user || !(0, access_service_1.isOwner)(req.user.telegramChatId))
        throw new errors_1.AppError(403, 'Только владелец может управлять доступом');
    next();
}));
router.get('/', (0, errors_1.route)(async (_req, res) => {
    const users = await db_1.prisma.adminUser.findMany({
        where: { telegramChatId: { notIn: [...env_1.env.TELEGRAM_ALLOWED_USER_IDS] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, telegramChatId: true, telegramUsername: true, role: true, accessStatus: true, requestedAt: true, approvedAt: true, lastLoginAt: true },
    });
    res.json({ users });
}));
router.post('/:id/decision', (0, errors_1.route)(async (req, res) => {
    const { action } = zod_1.z.object({ action: zod_1.z.enum(['APPROVE', 'REJECT', 'REVOKE']) }).strict().parse(req.body);
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const user = await (0, access_service_1.decideAccess)(id, req.user.telegramChatId, action);
    await telegram_bot_1.telegramBotService.notifyAccess(user.telegramChatId, action);
    res.json({ user });
}));
exports.default = router;

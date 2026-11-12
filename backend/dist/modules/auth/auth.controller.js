"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.getMe = exports.verifyCode = exports.requestCode = void 0;
const node_crypto_1 = require("node:crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const access_service_1 = require("./access.service");
const errors_1 = require("../../lib/errors");
const security_1 = require("../../lib/security");
exports.requestCode = (0, errors_1.route)(async (req, res) => {
    zod_1.z.object({}).strict().parse(req.body || {});
    if (!env_1.env.TELEGRAM_BOT_TOKEN || !env_1.env.TELEGRAM_ALLOWED_USER_IDS.size)
        throw new errors_1.AppError(503, 'Вход через Telegram пока не настроен');
    const id = (0, node_crypto_1.randomUUID)();
    const previous = req.cookies?.tanbox_challenge;
    if (typeof previous === 'string')
        await db_1.prisma.authCode.deleteMany({ where: { id: previous } });
    await db_1.prisma.authCode.create({ data: { id, code: '', telegramChatId: '', expiresAt: new Date(Date.now() + 5 * 60_000) } });
    res.cookie('tanbox_challenge', id, { ...security_1.challengeCookie, maxAge: 5 * 60_000 });
    res.json({ success: true, botUrl: 'https://t.me/' + env_1.env.TELEGRAM_BOT_USERNAME + '?start=login_' + id, expiresIn: 300 });
});
exports.verifyCode = (0, errors_1.route)(async (req, res) => {
    const { code } = zod_1.z.object({ code: zod_1.z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
    const challengeId = zod_1.z.string().uuid().safeParse(req.cookies?.tanbox_challenge);
    if (!challengeId.success)
        throw new errors_1.AppError(400, 'Получите новый код через кнопку Telegram');
    const result = await db_1.prisma.$transaction(async (tx) => {
        const attempt = await tx.authCode.updateMany({ where: { id: challengeId.data, isUsed: false, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 } } });
        if (!attempt.count)
            return null;
        const challenge = await tx.authCode.findUnique({ where: { id: challengeId.data } });
        if (!challenge || !(0, security_1.matchesCode)(challenge.id, code, challenge.code))
            return null;
        const existing = await tx.adminUser.findUnique({ where: { telegramChatId: challenge.telegramChatId } });
        if (!(0, access_service_1.isOwner)(challenge.telegramChatId) && (!existing || !(0, access_service_1.hasAccess)(existing)))
            return null;
        await tx.authCode.update({ where: { id: challenge.id }, data: { isUsed: true } });
        const user = await tx.adminUser.upsert({ where: { telegramChatId: challenge.telegramChatId },
            create: { telegramChatId: challenge.telegramChatId, telegramUsername: challenge.telegramUsername, role: 'ADMIN', accessStatus: 'APPROVED' },
            update: { telegramUsername: challenge.telegramUsername, ...((0, access_service_1.isOwner)(challenge.telegramChatId) ? { role: 'ADMIN', accessStatus: 'APPROVED' } : {}), lastLoginAt: new Date() },
        });
        const session = await tx.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
        return { user, session };
    });
    if (!result)
        throw new errors_1.AppError(400, 'Неверный или просроченный код. После пяти попыток получите новый код.');
    const token = jsonwebtoken_1.default.sign({ sub: result.user.id, jti: result.session.id }, env_1.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h', issuer: 'tanbox-crm', audience: 'tanbox-web' });
    res.cookie('tanbox_session', token, { ...security_1.sessionCookie, maxAge: 8 * 3600_000 });
    res.clearCookie('tanbox_challenge', security_1.challengeCookie);
    res.json({ user: result.user });
});
exports.getMe = (0, errors_1.route)(async (req, res) => { res.json({ user: req.user }); });
exports.logout = (0, errors_1.route)(async (req, res) => {
    if (req.sessionId)
        await db_1.prisma.authSession.deleteMany({ where: { id: req.sessionId } });
    res.clearCookie('tanbox_session', security_1.sessionCookie);
    res.clearCookie('tanbox_challenge', security_1.challengeCookie);
    res.json({ success: true });
});

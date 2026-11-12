"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAccess = exports.isOwner = void 0;
exports.requestAccess = requestAccess;
exports.decideAccess = decideAccess;
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const errors_1 = require("../../lib/errors");
exports.isOwner = env_1.isAllowedTelegramUser;
const hasAccess = (user) => (0, exports.isOwner)(user.telegramChatId) || (user.accessStatus === 'APPROVED' && user.role === 'STAFF');
exports.hasAccess = hasAccess;
async function requestAccess(telegramChatId, username) {
    if ((0, exports.isOwner)(telegramChatId))
        return { status: 'APPROVED', created: false };
    return db_1.prisma.$transaction(async (tx) => {
        const existing = await tx.adminUser.findUnique({ where: { telegramChatId } });
        if (existing?.accessStatus === 'APPROVED')
            return { status: 'APPROVED', created: false };
        if (existing?.accessStatus === 'PENDING')
            return { status: 'PENDING', created: false };
        // A rejected or revoked account may apply again, but no more than once per day.
        if (existing?.requestedAt && Date.now() - existing.requestedAt.getTime() < 24 * 3600_000)
            return { status: existing.accessStatus, created: false };
        const user = existing
            ? await tx.adminUser.update({ where: { id: existing.id }, data: { accessStatus: 'PENDING', requestedAt: new Date(), telegramUsername: username || null } })
            : await tx.adminUser.create({ data: { telegramChatId, telegramUsername: username || null, role: 'STAFF', accessStatus: 'PENDING', requestedAt: new Date() } });
        await tx.accessEvent.create({ data: { userId: user.id, action: 'REQUESTED' } });
        return { status: 'PENDING', created: true, user };
    });
}
async function decideAccess(userId, actorTelegramId, action) {
    if (!(0, exports.isOwner)(actorTelegramId))
        throw new errors_1.AppError(403, 'Только владелец может управлять доступом');
    return db_1.prisma.$transaction(async (tx) => {
        const user = await tx.adminUser.findUnique({ where: { id: userId } });
        if (!user || (0, exports.isOwner)(user.telegramChatId))
            throw new errors_1.AppError(400, 'Пользователь недоступен для изменения');
        const expected = action === 'REVOKE' ? 'APPROVED' : 'PENDING';
        if (user.accessStatus !== expected)
            throw new errors_1.AppError(409, 'Статус заявки уже изменился');
        const data = {
            accessStatus: action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'REVOKED',
            role: action === 'APPROVE' ? 'STAFF' : 'DISABLED',
            approvedAt: action === 'APPROVE' ? new Date() : null,
            approvedById: action === 'APPROVE' ? actorTelegramId : null,
        };
        const changed = await tx.adminUser.updateMany({ where: { id: user.id, accessStatus: expected }, data });
        if (!changed.count)
            throw new errors_1.AppError(409, 'Статус заявки уже изменился');
        const updated = await tx.adminUser.findUniqueOrThrow({ where: { id: user.id } });
        if (action !== 'APPROVE')
            await tx.authSession.deleteMany({ where: { userId: user.id } });
        await tx.accessEvent.create({ data: { userId: user.id, actorId: actorTelegramId, action } });
        return updated;
    });
}

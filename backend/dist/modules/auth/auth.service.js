"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueCode = issueCode;
const db_1 = require("../../config/db");
const access_service_1 = require("./access.service");
const security_1 = require("../../lib/security");
const errors_1 = require("../../lib/errors");
async function issueCode(challengeId, userId, username) {
    const user = await db_1.prisma.adminUser.findUnique({ where: { telegramChatId: userId } });
    if (!(0, access_service_1.isOwner)(userId) && (!user || !(0, access_service_1.hasAccess)(user)))
        throw new errors_1.AppError(403, 'Доступ не разрешён');
    const code = (0, security_1.newCode)();
    const updated = await db_1.prisma.authCode.updateMany({
        where: { id: challengeId, isUsed: false, expiresAt: { gt: new Date() }, code: '', telegramChatId: '' },
        data: { code: (0, security_1.hashCode)(challengeId, code), telegramChatId: userId, telegramUsername: username || null },
    });
    if (!updated.count)
        throw new errors_1.AppError(400, 'Откройте CRM и получите новую ссылку входа: прежняя уже использована или устарела.');
    return code;
}

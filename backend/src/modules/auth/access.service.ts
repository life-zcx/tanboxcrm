import { prisma } from '../../config/db';
import { isAllowedTelegramUser } from '../../config/env';
import { AppError } from '../../lib/errors';

export const isOwner = isAllowedTelegramUser;
export const hasAccess = (user: { telegramChatId: string; accessStatus: string; role: string }) =>
  isOwner(user.telegramChatId) || (user.accessStatus === 'APPROVED' && user.role === 'STAFF');

export async function requestAccess(telegramChatId: string, username?: string) {
  if (isOwner(telegramChatId)) return { status: 'APPROVED' as const, created: false };
  return prisma.$transaction(async tx => {
    const existing = await tx.adminUser.findUnique({ where: { telegramChatId } });
    if (existing?.accessStatus === 'APPROVED') return { status: 'APPROVED' as const, created: false };
    if (existing?.accessStatus === 'PENDING') return { status: 'PENDING' as const, created: false };
    // A rejected or revoked account may apply again, but no more than once per day.
    if (existing?.requestedAt && Date.now() - existing.requestedAt.getTime() < 24 * 3600_000)
      return { status: existing.accessStatus, created: false };
    const user = existing
      ? await tx.adminUser.update({ where: { id: existing.id }, data: { accessStatus: 'PENDING', requestedAt: new Date(), telegramUsername: username || null } })
      : await tx.adminUser.create({ data: { telegramChatId, telegramUsername: username || null, role: 'STAFF', accessStatus: 'PENDING', requestedAt: new Date() } });
    await tx.accessEvent.create({ data: { userId: user.id, action: 'REQUESTED' } });
    return { status: 'PENDING' as const, created: true, user };
  });
}

export async function decideAccess(userId: string, actorTelegramId: string, action: 'APPROVE' | 'REJECT' | 'REVOKE') {
  if (!isOwner(actorTelegramId)) throw new AppError(403, 'Только владелец может управлять доступом');
  return prisma.$transaction(async tx => {
    const user = await tx.adminUser.findUnique({ where: { id: userId } });
    if (!user || isOwner(user.telegramChatId)) throw new AppError(400, 'Пользователь недоступен для изменения');
    const expected = action === 'REVOKE' ? 'APPROVED' : 'PENDING';
    if (user.accessStatus !== expected) throw new AppError(409, 'Статус заявки уже изменился');
    const data = {
      accessStatus: action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'REVOKED',
      role: action === 'APPROVE' ? 'STAFF' : 'DISABLED',
      approvedAt: action === 'APPROVE' ? new Date() : null,
      approvedById: action === 'APPROVE' ? actorTelegramId : null,
    };
    const changed = await tx.adminUser.updateMany({ where: { id: user.id, accessStatus: expected }, data });
    if (!changed.count) throw new AppError(409, 'Статус заявки уже изменился');
    const updated = await tx.adminUser.findUniqueOrThrow({ where: { id: user.id } });
    if (action !== 'APPROVE') await tx.authSession.deleteMany({ where: { userId: user.id } });
    await tx.accessEvent.create({ data: { userId: user.id, actorId: actorTelegramId, action } });
    return updated;
  });
}

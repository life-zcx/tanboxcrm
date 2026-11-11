import { prisma } from '../../config/db';
import { isAllowedTelegramUser } from '../../config/env';
import { newCode, hashCode } from '../../lib/security';
import { AppError } from '../../lib/errors';
export async function issueCode(challengeId: string, userId: string, username?: string) {
  if (!isAllowedTelegramUser(userId)) throw new AppError(403, 'Доступ не разрешён');
  const code = newCode();
  const updated = await prisma.authCode.updateMany({
    where: { id: challengeId, isUsed: false, expiresAt: { gt: new Date() }, code: '', telegramChatId: '' },
    data: { code: hashCode(challengeId, code), telegramChatId: userId, telegramUsername: username || null },
  });
  if (!updated.count) throw new AppError(400, 'Откройте CRM и получите новую ссылку входа: прежняя уже использована или устарела.');
  return code;
}

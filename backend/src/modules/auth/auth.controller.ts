import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { env, isAllowedTelegramUser } from '../../config/env';
import { route, AppError } from '../../lib/errors';
import { matchesCode, sessionCookie, challengeCookie } from '../../lib/security';
export const requestCode = route(async (req, res) => {
  z.object({}).strict().parse(req.body || {});
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALLOWED_USER_IDS.size) throw new AppError(503, 'Вход через Telegram пока не настроен');
  const id = randomUUID();
  const previous = req.cookies?.tanbox_challenge;
  if (typeof previous === 'string') await prisma.authCode.deleteMany({ where: { id: previous } });
  await prisma.authCode.create({ data: { id, code: '', telegramChatId: '', expiresAt: new Date(Date.now() + 5 * 60_000) } });
  res.cookie('tanbox_challenge', id, { ...challengeCookie, maxAge: 5 * 60_000 });
  res.json({ success: true, botUrl: 'https://t.me/' + env.TELEGRAM_BOT_USERNAME + '?start=login_' + id, expiresIn: 300 });
});
export const verifyCode = route(async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
  const challengeId = z.string().uuid().safeParse(req.cookies?.tanbox_challenge);
  if (!challengeId.success) throw new AppError(400, 'Получите новый код через кнопку Telegram');
  const result = await prisma.$transaction(async tx => {
    const attempt = await tx.authCode.updateMany({ where: { id: challengeId.data, isUsed: false, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 } } });
    if (!attempt.count) return null;
    const challenge = await tx.authCode.findUnique({ where: { id: challengeId.data } });
    if (!challenge || !isAllowedTelegramUser(challenge.telegramChatId) || !matchesCode(challenge.id, code, challenge.code)) return null;
    await tx.authCode.update({ where: { id: challenge.id }, data: { isUsed: true } });
    const user = await tx.adminUser.upsert({ where: { telegramChatId: challenge.telegramChatId },
      create: { telegramChatId: challenge.telegramChatId, telegramUsername: challenge.telegramUsername, role: 'ADMIN' },
      update: { telegramUsername: challenge.telegramUsername, role: 'ADMIN', lastLoginAt: new Date() },
    });
    const session = await tx.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
    return { user, session };
  });
  if (!result) throw new AppError(400, 'Неверный или просроченный код. После пяти попыток получите новый код.');
  const token = jwt.sign({ sub: result.user.id, jti: result.session.id }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h', issuer: 'tanbox-crm', audience: 'tanbox-web' });
  res.cookie('tanbox_session', token, { ...sessionCookie, maxAge: 8 * 3600_000 });
  res.clearCookie('tanbox_challenge', challengeCookie);
  res.json({ user: result.user });
});
export const getMe = route(async (req, res) => { res.json({ user: req.user }); });
export const logout = route(async (req, res) => {
  if (req.sessionId) await prisma.authSession.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie('tanbox_session', sessionCookie);
  res.clearCookie('tanbox_challenge', challengeCookie);
  res.json({ success: true });
});

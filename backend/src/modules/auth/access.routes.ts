import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { AppError, route } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth.middleware';
import { decideAccess, isOwner } from './access.service';
import { telegramBotService } from '../../bot/telegram.bot';

const router = Router();
router.use(requireAuth, route(async (req, _res, next) => {
  if (!req.user || !isOwner(req.user.telegramChatId)) throw new AppError(403, 'Только владелец может управлять доступом');
  next();
}));
router.get('/', route(async (_req, res) => {
  const users = await prisma.adminUser.findMany({
    where: { telegramChatId: { notIn: [...env.TELEGRAM_ALLOWED_USER_IDS] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, telegramChatId: true, telegramUsername: true, role: true, accessStatus: true, requestedAt: true, approvedAt: true, lastLoginAt: true },
  });
  res.json({ users });
}));
router.post('/:id/decision', route(async (req, res) => {
  const { action } = z.object({ action: z.enum(['APPROVE', 'REJECT', 'REVOKE']) }).strict().parse(req.body);
  const id = z.string().uuid().parse(req.params.id);
  const user = await decideAccess(id, req.user!.telegramChatId, action);
  await telegramBotService.notifyAccess(user.telegramChatId, action);
  res.json({ user });
}));
export default router;

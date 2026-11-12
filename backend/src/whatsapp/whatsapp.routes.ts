import { Router } from 'express';
import { z } from 'zod';
import { route } from '../lib/errors';
import { whatsappService } from './whatsapp.service';
import { systemLogger } from '../lib/system-logger';

const router = Router();

router.get(
  '/status',
  route(async (_req, res) => {
    res.json(whatsappService.getStatus());
  })
);

router.post(
  '/connect',
  route(async (_req, res) => {
    void whatsappService.start();
    res.json({ ok: true, notice: 'Подключение инициировано' });
  })
);

router.post(
  '/logout',
  route(async (_req, res) => {
    await whatsappService.logout();
    res.json({ ok: true, notice: 'Сессия WhatsApp завершена' });
  })
);

router.post(
  '/restart',
  route(async (_req, res) => {
    await whatsappService.restart();
    res.json({ ok: true, notice: 'Перезапуск WhatsApp' });
  })
);

router.post(
  '/sync',
  route(async (_req, res) => {
    const result = await whatsappService.triggerHistorySync();
    res.json(result);
  })
);

router.get(
  '/feed',
  route(async (_req, res) => {
    res.json(whatsappService.getFeed());
  })
);

router.post(
  '/settings',
  route(async (req, res) => {
    const schema = z.object({
      autoCreateLeads: z.boolean().optional(),
      autoRunAi: z.boolean().optional(),
    }).strict();
    const parsed = schema.parse(req.body);
    const updated = whatsappService.updateSettings(parsed);
    res.json({ ok: true, settings: updated });
  })
);

router.get(
  '/logs',
  route(async (req, res) => {
    const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 200));
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const logs = systemLogger.getLogs(limit, filter, level);
    res.json({ logs });
  })
);

router.post(
  '/logs/clear',
  route(async (_req, res) => {
    systemLogger.clear();
    res.json({ ok: true, logs: systemLogger.getLogs() });
  })
);

export default router;

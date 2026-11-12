import { Router } from 'express';
import { z } from 'zod';
import { route } from '../../lib/errors';
import { systemLogger } from '../../lib/system-logger';

const router = Router();

router.get(
  '/',
  route(async (req, res) => {
    const limit = Math.min(2000, Math.max(10, Number(req.query.limit) || 500));
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const logs = systemLogger.getLogs(limit, category, level, search);
    res.json({ logs });
  })
);

router.post(
  '/frontend',
  route(async (req, res) => {
    const schema = z.object({
      level: z.enum(['INFO', 'WARN', 'ERROR']).default('INFO'),
      message: z.string().trim().min(1).max(2000),
      details: z.any().optional(),
    });

    const parsed = schema.parse(req.body);
    systemLogger.log('FRONTEND', parsed.level, parsed.message, parsed.details);
    res.json({ ok: true });
  })
);

router.post(
  '/clear',
  route(async (_req, res) => {
    systemLogger.clear();
    res.json({ ok: true, logs: systemLogger.getLogs(10) });
  })
);

export default router;


import { Router } from 'express';
import { requestCode, verifyCode, getMe, logout } from './auth.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { telegramLoginConfig, startTelegramLogin, finishTelegramLogin } from './telegram-oidc';

const router = Router();

router.post('/request-code', requestCode);
router.post('/verify-code', verifyCode);
router.get('/telegram/config', telegramLoginConfig);
router.get('/telegram/start', startTelegramLogin);
router.get('/telegram/callback', finishTelegramLogin);
router.get('/me', (req, res, next) => {
  if (!req.cookies?.tanbox_session) { res.json({user:null}); return; }
  requireAuth(req, res, next);
}, getMe);
router.post('/logout', requireAuth, logout);

export default router;


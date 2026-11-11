import { Router } from 'express';
import { requestCode, verifyCode, getMe, logout } from './auth.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

router.post('/request-code', requestCode);
router.post('/verify-code', verifyCode);
router.get('/me', (req, res, next) => {
  if (!req.cookies?.tanbox_session) { res.json({user:null}); return; }
  requireAuth(req, res, next);
}, getMe);
router.post('/logout', requireAuth, logout);

export default router;


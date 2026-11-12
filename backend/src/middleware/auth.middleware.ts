import jwt, { JwtPayload } from 'jsonwebtoken';
import { isUUID } from '../lib/uuid';
import { env } from '../config/env';
import { hasAccess } from '../modules/auth/access.service';
import { prisma } from '../config/db';
import { route, AppError } from '../lib/errors';
export interface AuthUser { id: string; telegramChatId: string; telegramUsername: string | null; role: string; }
declare global { namespace Express { interface Request { user?: AuthUser; sessionId?: string; } } }
export const requireAuth = route(async (req, _res, next) => {
  const token = req.cookies?.tanbox_session;
  if (typeof token !== 'string') throw new AppError(401, 'Требуется вход в CRM');
  let decoded: JwtPayload;
  try {
    const value = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'tanbox-crm', audience: 'tanbox-web' });
    if (typeof value === 'string' || typeof value.sub !== 'string' || typeof value.jti !== 'string' || !isUUID(value.sub) || !isUUID(value.jti)) throw new Error();
    decoded = value;
  } catch { throw new AppError(401, 'Сессия истекла. Войдите снова.'); }
  const session = await prisma.authSession.findUnique({ where: { id: decoded.jti! }, include: { user: true } });
  if (!session || session.userId !== decoded.sub || session.expiresAt <= new Date() || !hasAccess(session.user)) throw new AppError(401, 'Сессия недействительна');
  req.user = session.user;
  req.sessionId = session.id;
  next();
});

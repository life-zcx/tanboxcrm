import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { AppError, route } from '../../lib/errors';
import { sessionCookie } from '../../lib/security';
import { hasAccess, isOwner, requestAccess } from './access.service';
import { telegramBotService } from '../../bot/telegram.bot';

const issuer = 'https://oauth.telegram.org';
const callbackPath = '/api/auth/telegram/callback';
const callbackUrl = () => env.APP_ORIGIN + callbackPath;
const flowCookie = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/api/auth/telegram' };
const jwks = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'), { timeoutDuration: 7000 });
const base64url = (value: Buffer) => value.toString('base64url');
type Flow = { state: string; verifier: string; expires: number };

export const telegramLoginConfig = route(async (_req, res) => {
  res.json({ enabled: Boolean(env.TELEGRAM_LOGIN_CLIENT_ID && env.TELEGRAM_LOGIN_CLIENT_SECRET) });
});

export const startTelegramLogin = route(async (_req, res) => {
  if (!env.TELEGRAM_LOGIN_CLIENT_ID || !env.TELEGRAM_LOGIN_CLIENT_SECRET)
    throw new AppError(503, 'Вход через Telegram пока не настроен');
  const flow: Flow = {
    state: base64url(randomBytes(32)),
    verifier: base64url(randomBytes(32)),
    expires: Date.now() + 5 * 60_000,
  };
  res.cookie('tanbox_oidc', Buffer.from(JSON.stringify(flow)).toString('base64url'), { ...flowCookie, maxAge: 5 * 60_000 });
  const url = new URL(issuer + '/auth');
  url.search = new URLSearchParams({
    client_id: env.TELEGRAM_LOGIN_CLIENT_ID,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: 'openid profile telegram:bot_access',
    state: flow.state,
    code_challenge: base64url(createHash('sha256').update(flow.verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
  res.redirect(302, url.toString());
});

export const finishTelegramLogin = route(async (req: Request, res: Response) => {
  const failure = (reason: string) => res.redirect(303, '/login?telegram=' + encodeURIComponent(reason));
  const raw = req.cookies?.tanbox_oidc;
  res.clearCookie('tanbox_oidc', flowCookie);
  let flow: Flow | undefined;
  try { flow = JSON.parse(Buffer.from(raw || '', 'base64url').toString('utf8')); } catch { /* invalid or missing cookie */ }
  if (!flow || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' || flow.expires < Date.now() ||
      req.query.state !== flow.state || !/^[A-Za-z0-9_-]{40,100}$/.test(flow.verifier) || typeof req.query.code !== 'string')
    return failure('expired');
  if (!env.TELEGRAM_LOGIN_CLIENT_ID || !env.TELEGRAM_LOGIN_CLIENT_SECRET) return failure('unavailable');

  let telegramId: string;
  let username: string | undefined;
  try {
    const tokenResponse = await fetch(issuer + '/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(env.TELEGRAM_LOGIN_CLIENT_ID + ':' + env.TELEGRAM_LOGIN_CLIENT_SECRET).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: req.query.code,
        redirect_uri: callbackUrl(), client_id: env.TELEGRAM_LOGIN_CLIENT_ID,
        code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenResponse.ok) return failure('failed');
    const tokens = await tokenResponse.json() as { id_token?: unknown };
    if (typeof tokens.id_token !== 'string') return failure('failed');
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer, audience: env.TELEGRAM_LOGIN_CLIENT_ID, algorithms: ['RS256'], clockTolerance: 30,
    });
    if (typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 30 ||
        typeof payload.id !== 'number' || !Number.isSafeInteger(payload.id) || payload.id <= 0)
      return failure('failed');
    telegramId = String(payload.id);
    username = typeof payload.preferred_username === 'string' ? payload.preferred_username.slice(0, 64) : undefined;
  } catch (error) {
    console.error('Telegram OIDC exchange failed', error instanceof Error ? error.name : 'unknown');
    return failure('failed');
  }

  if (!isOwner(telegramId)) {
    const access = await requestAccess(telegramId, username);
    if (access.created && access.user) await telegramBotService.notifyAccessRequest(access.user.id, telegramId, username);
    if (access.status !== 'APPROVED') return failure(access.status === 'PENDING' ? 'pending' : 'denied');
  }
  const result = await prisma.$transaction(async tx => {
    const user = await tx.adminUser.upsert({ where: { telegramChatId: telegramId },
      create: { telegramChatId: telegramId, telegramUsername: username, role: 'ADMIN', accessStatus: 'APPROVED' },
      update: { telegramUsername: username, ...(isOwner(telegramId) ? { role: 'ADMIN', accessStatus: 'APPROVED' } : {}), lastLoginAt: new Date() },
    });
    if (!hasAccess(user)) throw new AppError(403, 'Доступ к CRM не одобрен');
    const session = await tx.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
    return { user, session };
  });
  const token = jwt.sign({ sub: result.user.id, jti: result.session.id }, env.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: '8h', issuer: 'tanbox-crm', audience: 'tanbox-web',
  });
  res.cookie('tanbox_session', token, { ...sessionCookie, maxAge: 8 * 3600_000 });
  res.redirect(303, '/deals');
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishTelegramLogin = exports.startTelegramLogin = exports.telegramLoginConfig = void 0;
const node_crypto_1 = require("node:crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jose_1 = require("jose");
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const errors_1 = require("../../lib/errors");
const security_1 = require("../../lib/security");
const access_service_1 = require("./access.service");
const telegram_bot_1 = require("../../bot/telegram.bot");
const issuer = 'https://oauth.telegram.org';
const callbackPath = '/api/auth/telegram/callback';
const callbackUrl = () => env_1.env.APP_ORIGIN + callbackPath;
const flowCookie = { httpOnly: true, secure: env_1.env.COOKIE_SECURE, sameSite: 'lax', path: '/api/auth/telegram' };
const jwks = (0, jose_1.createRemoteJWKSet)(new URL(issuer + '/.well-known/jwks.json'), { timeoutDuration: 7000 });
const base64url = (value) => value.toString('base64url');
exports.telegramLoginConfig = (0, errors_1.route)(async (_req, res) => {
    res.json({ enabled: Boolean(env_1.env.TELEGRAM_LOGIN_CLIENT_ID && env_1.env.TELEGRAM_LOGIN_CLIENT_SECRET) });
});
exports.startTelegramLogin = (0, errors_1.route)(async (_req, res) => {
    if (!env_1.env.TELEGRAM_LOGIN_CLIENT_ID || !env_1.env.TELEGRAM_LOGIN_CLIENT_SECRET)
        throw new errors_1.AppError(503, 'Вход через Telegram пока не настроен');
    const flow = {
        state: base64url((0, node_crypto_1.randomBytes)(32)),
        verifier: base64url((0, node_crypto_1.randomBytes)(32)),
        expires: Date.now() + 5 * 60_000,
    };
    res.cookie('tanbox_oidc', Buffer.from(JSON.stringify(flow)).toString('base64url'), { ...flowCookie, maxAge: 5 * 60_000 });
    const url = new URL(issuer + '/auth');
    url.search = new URLSearchParams({
        client_id: env_1.env.TELEGRAM_LOGIN_CLIENT_ID,
        redirect_uri: callbackUrl(),
        response_type: 'code',
        scope: 'openid profile telegram:bot_access',
        state: flow.state,
        code_challenge: base64url((0, node_crypto_1.createHash)('sha256').update(flow.verifier).digest()),
        code_challenge_method: 'S256',
    }).toString();
    res.redirect(302, url.toString());
});
exports.finishTelegramLogin = (0, errors_1.route)(async (req, res) => {
    const failure = (reason) => res.redirect(303, '/login?telegram=' + encodeURIComponent(reason));
    const raw = req.cookies?.tanbox_oidc;
    res.clearCookie('tanbox_oidc', flowCookie);
    let flow;
    try {
        flow = JSON.parse(Buffer.from(raw || '', 'base64url').toString('utf8'));
    }
    catch { /* invalid or missing cookie */ }
    if (!flow || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' || flow.expires < Date.now() ||
        req.query.state !== flow.state || !/^[A-Za-z0-9_-]{40,100}$/.test(flow.verifier) || typeof req.query.code !== 'string')
        return failure('expired');
    if (!env_1.env.TELEGRAM_LOGIN_CLIENT_ID || !env_1.env.TELEGRAM_LOGIN_CLIENT_SECRET)
        return failure('unavailable');
    let telegramId;
    let username;
    try {
        const tokenResponse = await fetch(issuer + '/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + Buffer.from(env_1.env.TELEGRAM_LOGIN_CLIENT_ID + ':' + env_1.env.TELEGRAM_LOGIN_CLIENT_SECRET).toString('base64'),
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code', code: req.query.code,
                redirect_uri: callbackUrl(), client_id: env_1.env.TELEGRAM_LOGIN_CLIENT_ID,
                code_verifier: flow.verifier,
            }),
            signal: AbortSignal.timeout(8000),
        });
        if (!tokenResponse.ok) {
            console.error('Telegram OIDC token endpoint rejected exchange:', tokenResponse.status);
            return failure('failed');
        }
        const tokens = await tokenResponse.json();
        if (typeof tokens.id_token !== 'string') {
            console.error('Telegram OIDC response has no ID token');
            return failure('failed');
        }
        const { payload } = await (0, jose_1.jwtVerify)(tokens.id_token, jwks, {
            issuer, audience: env_1.env.TELEGRAM_LOGIN_CLIENT_ID, algorithms: ['RS256'], clockTolerance: 30,
        });
        const idClaim = payload.id;
        const idText = typeof idClaim === 'string' ? idClaim : typeof idClaim === 'number' ? String(idClaim) : '';
        if (typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 30 ||
            !/^[1-9]\d{0,15}$/.test(idText) || !Number.isSafeInteger(Number(idText))) {
            console.error('Telegram OIDC ID token missing valid identity claims', {
                issuedAt: typeof payload.iat, id: typeof payload.id, subject: typeof payload.sub,
            });
            return failure('failed');
        }
        telegramId = idText;
        username = typeof payload.preferred_username === 'string' ? payload.preferred_username.slice(0, 64) : undefined;
    }
    catch (error) {
        console.error('Telegram OIDC exchange failed', error instanceof Error ? error.name + ': ' + error.message.slice(0, 180) : 'unknown');
        return failure('failed');
    }
    if (!(0, access_service_1.isOwner)(telegramId)) {
        const access = await (0, access_service_1.requestAccess)(telegramId, username);
        if (access.created && access.user)
            await telegram_bot_1.telegramBotService.notifyAccessRequest(access.user.id, telegramId, username);
        if (access.status !== 'APPROVED')
            return failure(access.status === 'PENDING' ? 'pending' : 'denied');
    }
    const result = await db_1.prisma.$transaction(async (tx) => {
        const user = await tx.adminUser.upsert({ where: { telegramChatId: telegramId },
            create: { telegramChatId: telegramId, telegramUsername: username, role: 'ADMIN', accessStatus: 'APPROVED' },
            update: { telegramUsername: username, ...((0, access_service_1.isOwner)(telegramId) ? { role: 'ADMIN', accessStatus: 'APPROVED' } : {}), lastLoginAt: new Date() },
        });
        if (!(0, access_service_1.hasAccess)(user))
            throw new errors_1.AppError(403, 'Доступ к CRM не одобрен');
        const session = await tx.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
        return { user, session };
    });
    const token = jsonwebtoken_1.default.sign({ sub: result.user.id, jti: result.session.id }, env_1.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '8h', issuer: 'tanbox-crm', audience: 'tanbox-web',
    });
    res.cookie('tanbox_session', token, { ...security_1.sessionCookie, maxAge: 8 * 3600_000 });
    res.redirect(303, '/deals');
});

import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
export const newCode = () => randomInt(100000, 1000000).toString();
export const hashCode = (challenge: string, code: string) => createHmac('sha256', env.JWT_SECRET).update(challenge + ':' + code).digest('hex');
export function matchesCode(challenge: string, code: string, stored: string) {
  const digest = hashCode(challenge, code);
  return stored.length === digest.length && timingSafeEqual(Buffer.from(digest), Buffer.from(stored));
}
export const sessionCookie = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };
export const challengeCookie = { ...sessionCookie, path: '/api/auth' };

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

const lifetimeMs = 30 * 60 * 1000;
function signature(fingerprint: string, expires: number) {
  return createHmac('sha256', env.JWT_SECRET).update(`screenshot-review:${fingerprint}:${expires}`).digest('hex');
}
export function issueScreenshotReviewToken(fingerprint: string, now = Date.now()) {
  const expires = now + lifetimeMs;
  return `${expires}.${signature(fingerprint, expires)}`;
}
export function verifyScreenshotReviewToken(token: string, fingerprint: string, now = Date.now()) {
  const match = /^(\d{13})\.([0-9a-f]{64})$/.exec(token);
  if (!match || Number(match[1]) < now || Number(match[1]) > now + lifetimeMs) throw new AppError(400, 'Проверка устарела. Распознайте скриншоты ещё раз.');
  const actual = Buffer.from(match[2], 'hex');
  const expected = Buffer.from(signature(fingerprint, Number(match[1])), 'hex');
  if (!timingSafeEqual(actual, expected)) throw new AppError(400, 'Файлы или привязка к клиенту изменились. Распознайте скриншоты ещё раз.');
}

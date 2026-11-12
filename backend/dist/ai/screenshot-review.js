"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueScreenshotReviewToken = issueScreenshotReviewToken;
exports.verifyScreenshotReviewToken = verifyScreenshotReviewToken;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
const errors_1 = require("../lib/errors");
const lifetimeMs = 30 * 60 * 1000;
function signature(fingerprint, expires) {
    return (0, node_crypto_1.createHmac)('sha256', env_1.env.JWT_SECRET).update(`screenshot-review:${fingerprint}:${expires}`).digest('hex');
}
function issueScreenshotReviewToken(fingerprint, now = Date.now()) {
    const expires = now + lifetimeMs;
    return `${expires}.${signature(fingerprint, expires)}`;
}
function verifyScreenshotReviewToken(token, fingerprint, now = Date.now()) {
    const match = /^(\d{13})\.([0-9a-f]{64})$/.exec(token);
    if (!match || Number(match[1]) < now || Number(match[1]) > now + lifetimeMs)
        throw new errors_1.AppError(400, 'Проверка устарела. Распознайте скриншоты ещё раз.');
    const actual = Buffer.from(match[2], 'hex');
    const expected = Buffer.from(signature(fingerprint, Number(match[1])), 'hex');
    if (!(0, node_crypto_1.timingSafeEqual)(actual, expected))
        throw new errors_1.AppError(400, 'Файлы или привязка к клиенту изменились. Распознайте скриншоты ещё раз.');
}

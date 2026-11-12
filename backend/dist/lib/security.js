"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.challengeCookie = exports.sessionCookie = exports.hashCode = exports.newCode = void 0;
exports.matchesCode = matchesCode;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
const newCode = () => (0, node_crypto_1.randomInt)(100000, 1000000).toString();
exports.newCode = newCode;
const hashCode = (challenge, code) => (0, node_crypto_1.createHmac)('sha256', env_1.env.JWT_SECRET).update(challenge + ':' + code).digest('hex');
exports.hashCode = hashCode;
function matchesCode(challenge, code, stored) {
    const digest = (0, exports.hashCode)(challenge, code);
    return stored.length === digest.length && (0, node_crypto_1.timingSafeEqual)(Buffer.from(digest), Buffer.from(stored));
}
exports.sessionCookie = { httpOnly: true, secure: env_1.env.COOKIE_SECURE, sameSite: 'strict', path: '/' };
exports.challengeCookie = { ...exports.sessionCookie, path: '/api/auth' };

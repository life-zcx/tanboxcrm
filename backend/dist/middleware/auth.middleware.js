"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("../lib/uuid");
const env_1 = require("../config/env");
const access_service_1 = require("../modules/auth/access.service");
const db_1 = require("../config/db");
const errors_1 = require("../lib/errors");
exports.requireAuth = (0, errors_1.route)(async (req, _res, next) => {
    const token = req.cookies?.tanbox_session;
    if (typeof token !== 'string')
        throw new errors_1.AppError(401, 'Требуется вход в CRM');
    let decoded;
    try {
        const value = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'tanbox-crm', audience: 'tanbox-web' });
        if (typeof value === 'string' || typeof value.sub !== 'string' || typeof value.jti !== 'string' || !(0, uuid_1.isUUID)(value.sub) || !(0, uuid_1.isUUID)(value.jti))
            throw new Error();
        decoded = value;
    }
    catch {
        throw new errors_1.AppError(401, 'Сессия истекла. Войдите снова.');
    }
    const session = await db_1.prisma.authSession.findUnique({ where: { id: decoded.jti }, include: { user: true } });
    if (!session || session.userId !== decoded.sub || session.expiresAt <= new Date() || !(0, access_service_1.hasAccess)(session.user))
        throw new errors_1.AppError(401, 'Сессия недействительна');
    req.user = session.user;
    req.sessionId = session.id;
    next();
});

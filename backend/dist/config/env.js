"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAllowedTelegramUser = exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const node_path_1 = __importDefault(require("node:path"));
dotenv_1.default.config();
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 48 || /tanbox-crm|super-secure|change.me/i.test(jwtSecret))
    throw new Error('JWT_SECRET must be a unique random secret of at least 48 characters');
const databaseUrl = process.env.DATABASE_URL || '';
if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error('DATABASE_URL must point to PostgreSQL');
const allowedIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (allowedIds.some(s => !/^\d+$/.test(s)))
    throw new Error('Invalid TELEGRAM_ALLOWED_USER_IDS');
const appOrigin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3050').origin;
exports.env = {
    PORT: Number(process.env.PORT || 5055), HOST: process.env.HOST || '127.0.0.1',
    DATABASE_URL: databaseUrl, TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || 'tanboxcrmbot',
    TELEGRAM_LOGIN_CLIENT_ID: process.env.TELEGRAM_LOGIN_CLIENT_ID || '',
    TELEGRAM_LOGIN_CLIENT_SECRET: process.env.TELEGRAM_LOGIN_CLIENT_SECRET || '',
    TELEGRAM_ALLOWED_USER_IDS: new Set(allowedIds), TELEGRAM_POLLING: process.env.TELEGRAM_POLLING !== 'false',
    GOOGLE_GEMINI_API_KEY: process.env.GOOGLE_GEMINI_API_KEY || '',
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    GEMINI_FALLBACK_MODELS: (process.env.GEMINI_FALLBACK_MODELS || '').split(',').filter(Boolean),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '', JWT_SECRET: jwtSecret,
    APP_ORIGIN: appOrigin, COOKIE_SECURE: appOrigin.startsWith('https:'),
    TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS === '1' ? 1 : false,
    KNOWLEDGE_AUTO_COLLECT: process.env.KNOWLEDGE_AUTO_COLLECT === 'true' || process.env.NODE_ENV === 'production' && process.env.KNOWLEDGE_AUTO_COLLECT !== 'false',
    UPLOADS_DIR: node_path_1.default.resolve(process.env.UPLOADS_DIR || node_path_1.default.join(process.cwd(), 'uploads')),
};
if (!Number.isInteger(exports.env.PORT) || exports.env.PORT < 1 || exports.env.PORT > 65535)
    throw new Error('Invalid PORT');
const isAllowedTelegramUser = (id) => exports.env.TELEGRAM_ALLOWED_USER_IDS.has(String(id));
exports.isAllowedTelegramUser = isAllowedTelegramUser;

import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config();
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 48 || /tanbox-crm|super-secure|change.me/i.test(jwtSecret)) throw new Error('JWT_SECRET must be a unique random secret of at least 48 characters');
const databaseUrl = process.env.DATABASE_URL || '';
if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must point to PostgreSQL');
const allowedIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (allowedIds.some(s => !/^\d+$/.test(s))) throw new Error('Invalid TELEGRAM_ALLOWED_USER_IDS');
const appOrigin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3050').origin;
export const env = {
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
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS === '1' ? 1 : false as false,
  KNOWLEDGE_AUTO_COLLECT: process.env.KNOWLEDGE_AUTO_COLLECT==='true'||process.env.NODE_ENV==='production'&&process.env.KNOWLEDGE_AUTO_COLLECT!=='false',
  UPLOADS_DIR: path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads')),
};
if (!Number.isInteger(env.PORT) || env.PORT < 1 || env.PORT > 65535) throw new Error('Invalid PORT');
export const isAllowedTelegramUser = (id: string | number) => env.TELEGRAM_ALLOWED_USER_IDS.has(String(id));

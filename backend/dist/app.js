"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const express_rate_limit_1 = require("express-rate-limit");
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const auth_middleware_1 = require("./middleware/auth.middleware");
const errors_1 = require("./lib/errors");
const files_1 = require("./lib/files");
const client_deletion_service_1 = require("./modules/clients/client-deletion.service");
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const access_routes_1 = __importDefault(require("./modules/auth/access.routes"));
const clients_routes_1 = __importDefault(require("./modules/clients/clients.routes"));
const messages_routes_1 = __importDefault(require("./modules/messages/messages.routes"));
const ai_routes_1 = __importDefault(require("./modules/ai/ai.routes"));
const deals_routes_1 = __importDefault(require("./modules/deals/deals.routes"));
const settings_routes_1 = __importDefault(require("./modules/settings/settings.routes"));
const whatsapp_routes_1 = __importDefault(require("./whatsapp/whatsapp.routes"));
const logs_routes_1 = __importDefault(require("./modules/logs/logs.routes"));
const system_logger_1 = require("./lib/system-logger");
function createApp() {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', env_1.env.TRUST_PROXY_HOPS);
    app.use((0, helmet_1.default)({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
    app.use((0, cors_1.default)({ origin: env_1.env.APP_ORIGIN, credentials: true }));
    app.use((0, cookie_parser_1.default)());
    app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    // Логирование всех входящих HTTP-запросов к API бэкенда
    app.use((req, res, next) => {
        const isLogPoll = req.path === '/api/health' ||
            req.path === '/api/logs' ||
            req.path === '/api/whatsapp/logs' ||
            req.path === '/api/whatsapp/status' ||
            req.path === '/api/whatsapp/feed';
        if (isLogPoll)
            return next();
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const status = res.statusCode;
            const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
            system_logger_1.systemLogger.log('BACKEND', level, `${req.method} ${req.originalUrl || req.url} -> ${status} (${duration}ms)`);
        });
        next();
    });
    app.use('/api', (0, express_rate_limit_1.rateLimit)({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много запросов. Повторите позже.' } }));
    app.use('/api', (req, _res, next) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            const origin = req.get('origin'), site = req.get('sec-fetch-site');
            if ((origin && origin !== env_1.env.APP_ORIGIN) || site === 'cross-site') {
                next(new errors_1.AppError(403, 'Запрос с другого сайта отклонён'));
                return;
            }
            if (!origin && req.cookies?.tanbox_session) {
                next(new errors_1.AppError(403, 'Отсутствует Origin'));
                return;
            }
        }
        next();
    });
    app.use(express_1.default.json({ limit: '256kb' }));
    app.get('/api/health', (0, errors_1.route)(async (_req, res) => { await db_1.prisma.$queryRaw `SELECT 1`; res.json({ status: 'ok', service: 'Tanbox CRM' }); }));
    app.use('/api/auth', (0, express_rate_limit_1.rateLimit)({ windowMs: 60000, limit: process.env.CRM_TEST_DATABASE === '1' ? 100 : 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много попыток входа. Подождите минуту.' } }), auth_routes_1.default);
    app.use('/api/access', access_routes_1.default);
    app.use('/uploads', auth_middleware_1.requireAuth, (0, errors_1.route)(async (req, res) => {
        const filename = (0, files_1.imageFilename)('/uploads' + req.path);
        if (!filename)
            throw new errors_1.AppError(404, 'Изображение не найдено');
        const reference = await db_1.prisma.conversationChunk.findFirst({ where: (0, client_deletion_service_1.screenshotReference)('/uploads/' + filename), select: { id: true } });
        if (!reference)
            throw new errors_1.AppError(404, 'Изображение не найдено');
        const filePath = node_path_1.default.join(env_1.env.UPLOADS_DIR, filename);
        try {
            await promises_1.default.access(filePath);
        }
        catch {
            throw new errors_1.AppError(404, 'Изображение не найдено');
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.type(filename.split('.').pop());
        res.sendFile(filePath);
    }));
    app.use('/api/clients', auth_middleware_1.requireAuth, clients_routes_1.default);
    app.use('/api/deals', auth_middleware_1.requireAuth, deals_routes_1.default);
    app.use('/api/messages', auth_middleware_1.requireAuth, messages_routes_1.default);
    app.use('/api/ai', auth_middleware_1.requireAuth, ai_routes_1.default);
    app.use('/api/settings', auth_middleware_1.requireAuth, settings_routes_1.default);
    app.use('/api/whatsapp', auth_middleware_1.requireAuth, whatsapp_routes_1.default);
    app.use('/api/logs', auth_middleware_1.requireAuth, logs_routes_1.default);
    app.use((_req, _res, next) => next(new errors_1.AppError(404, 'Маршрут не найден')));
    app.use(errors_1.errorHandler);
    return app;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramBotService = exports.TelegramBotService = exports.BOT_LABELS = void 0;
const node_crypto_1 = require("node:crypto");
const telegraf_1 = require("telegraf");
const zod_1 = require("zod");
const env_1 = require("../config/env");
const db_1 = require("../config/db");
const auth_service_1 = require("../modules/auth/auth.service");
const access_service_1 = require("../modules/auth/access.service");
const ai_orchestrator_1 = require("../ai/ai.orchestrator");
const gemini_service_1 = require("../ai/gemini.service");
const screenshot_drafts_service_1 = require("./screenshot-drafts.service");
const knowledge_service_1 = require("../ai/knowledge.service");
const errors_1 = require("../lib/errors");
const files_1 = require("../lib/files");
const validation_1 = require("../lib/validation");
const client_deletion_service_1 = require("../modules/clients/client-deletion.service");
const archive_service_1 = require("../knowledge/archive.service");
const web_service_1 = require("../knowledge/web.service");
const pricing_service_1 = require("../pricing/pricing.service");
const client_widget_1 = require("./client-widget");
const dashboard_widget_1 = require("./dashboard-widget");
exports.BOT_LABELS = { upload: '📸 Загрузить переписку', clients: '👥 Клиенты', reply: '💡 Что ответить', pipeline: '📊 Воронка', knowledge: '📚 База знаний', login: '🔐 Вход в веб', help: '❓ Помощь' };
const labels = { LEAD: 'Новый лид', IN_NEGOTIATION: 'В переговорах', KP_SENT: 'КП отправлено', PAYMENT_PENDING: 'Ожидает оплаты', IN_PROGRESS: 'В работе', WON: 'Оплачено', LOST: 'Отказ' };
const stageLabels = { NEW: 'Новые лиды', QUALIFIED: 'В переговорах', OFFER_SENT: 'КП отправлено', INVOICED: 'Ожидают оплаты', PAID: 'Оплачено', CLOSED_LOST: 'Отказы' };
class TelegramBotService {
    bot = env_1.env.TELEGRAM_BOT_TOKEN ? new telegraf_1.Telegraf(env_1.env.TELEGRAM_BOT_TOKEN, { handlerTimeout: 90000 }) : null;
    owner = (0, node_crypto_1.randomUUID)();
    leaseKey = 'telegram-polling-lease';
    running = false;
    starting = false;
    stopping = false;
    state = 'stopped';
    retryTimer;
    leaseTimer;
    batches = new Map();
    userRequests = new Map();
    users = new Map();
    constructor() {
        if (this.bot) {
            const telegram = this.bot.telegram, call = telegram.callApi.bind(telegram);
            telegram.callApi = async (method, ...args) => {
                if (method === 'getUpdates' && !this.stopping) {
                    this.running = true;
                    this.state = 'running';
                }
                try {
                    return await call(method, ...args);
                }
                catch (error) {
                    if (method === 'getUpdates') {
                        this.running = false;
                        this.state = 'reconnecting';
                    }
                    throw error;
                }
            };
            this.registerHandlers();
        }
    }
    isAvailable() { return this.running; }
    async notifyAccessRequest(userId, telegramId, username) {
        if (!this.bot)
            return;
        for (const ownerId of env_1.env.TELEGRAM_ALLOWED_USER_IDS) {
            try {
                await this.bot.telegram.sendMessage(ownerId, 'Заявка на доступ к TANBOX CRM\n@' + (username || 'нет username') + '\nTelegram ID: ' + telegramId, { reply_markup: { inline_keyboard: [[telegraf_1.Markup.button.callback('Одобрить', 'access:approve:' + userId), telegraf_1.Markup.button.callback('Отклонить', 'access:reject:' + userId)]] } });
            }
            catch (error) {
                console.error('Access notification failed', this.safeError(error));
            }
        }
    }
    async notifyAccess(telegramChatId, action) {
        if (!this.bot)
            return;
        const message = action === 'APPROVE' ? 'Доступ к TANBOX CRM одобрен. Откройте сайт CRM и нажмите «Войти через Telegram».' : action === 'REJECT' ? 'Заявка на доступ к TANBOX CRM отклонена.' : 'Доступ к TANBOX CRM отозван владельцем.';
        try {
            await this.bot.telegram.sendMessage(telegramChatId, message);
        }
        catch (error) {
            console.error('Access decision notification failed', this.safeError(error));
        }
    }
    getStatus() { return { configured: !!this.bot, running: this.running, state: this.state, name: env_1.env.TELEGRAM_BOT_USERNAME }; }
    safeError(error) {
        return String(error?.response?.description || error?.message || error?.name || 'network')
            .split(env_1.env.TELEGRAM_BOT_TOKEN || '__no_token__').join('[redacted]').replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 240);
    }
    session(ctx) {
        const key = String(ctx.from.id), old = this.users.get(key);
        if (old && (old.busy || Date.now() - old.updated < 30 * 60_000)) {
            old.updated = Date.now();
            return old;
        }
        const value = { updated: Date.now() };
        this.users.set(key, value);
        return value;
    }
    async reply(ctx, text, extra = {}) {
        const pieces = text.match(/[\s\S]{1,3500}/g) || [''];
        const close = { text: '✖️ Закрыть', callback_data: 'close' };
        for (let i = 0; i < pieces.length; i++) {
            const last = i === pieces.length - 1, markup = last ? extra.reply_markup : undefined;
            const buttons = markup?.inline_keyboard;
            const withClose = buttons ? { ...extra, reply_markup: { ...markup, inline_keyboard: [...buttons, [close]] } } :
                pieces[i].length >= 300 || !last ? { ...extra, reply_markup: { inline_keyboard: [[close]] } } :
                    { ...telegraf_1.Markup.removeKeyboard(), ...extra };
            await ctx.reply(pieces[i], withClose);
        }
    }
    userError(error) { return error instanceof errors_1.AppError ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'; }
    webLink(path) {
        const host = new URL(env_1.env.APP_ORIGIN).hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
            return null;
        return telegraf_1.Markup.button.url('🌐 Открыть в CRM', env_1.env.APP_ORIGIN + path);
    }
    async home(ctx) {
        const s = this.session(ctx);
        s.mode = undefined;
        s.pendingText = undefined;
        s.targetClientId = undefined;
        try {
            await this.sendDashboardWidget(ctx, 'home');
            return;
        }
        catch (error) {
            console.warn('Dashboard widget unavailable:', this.safeError(error));
        }
        await this.reply(ctx, 'TANBOX CRM — клиенты и переговоры\n\n📸 Отправьте скриншоты WhatsApp: сначала покажу распознанный черновик, затем вы подтвердите сохранение. Текст переписки тоже можно отправить в бот.\n💡 Помогу подготовить ответ с учётом истории и тарифов.\n👥 В карточке клиента доступны досье, статусы и добавление переписки.\n\nВыберите действие в меню ниже. Вход по коду нужен только для веб-панели.');
    }
    async help(ctx) {
        await this.reply(ctx, 'Как работать с CRM\n\n1. Нажмите «Загрузить переписку». Отправьте текст или 1–15 скриншотов одной беседы.\n2. Для скриншотов проверьте черновик: автора, текст и порядок сообщений. Исправьте ошибки и нажмите «Сохранить». Черновик доступен через /review 30 минут.\n3. После сохранения откроется карточка: «Что ответить», «Добавить переписку», «Изменить статус».\n4. В «Клиенты» есть поиск, страницы и история.\n\nФайлы: PNG/JPG/WEBP, до 10 МБ каждый, до 40 МБ суммарно. Каждая пачка — один диалог.\n\nВеб-панель: ' + env_1.env.APP_ORIGIN + '\nДля входа нажмите кнопку Telegram на странице входа. /cancel — отменить выбор действия.');
    }
    async login(ctx) { await this.reply(ctx, 'Вход в веб-панель\n\nОткройте ' + env_1.env.APP_ORIGIN + ' на компьютере, нажмите «Получить код в Telegram», затем откройте бота по появившейся ссылке.\n\nКод будет действовать только для этого запроса. Все функции CRM в боте доступны через меню ниже.'); }
    async importHelp(ctx, targetClientId) {
        const s = this.session(ctx);
        s.mode = 'import';
        s.targetClientId = targetClientId;
        s.pendingText = undefined;
        const client = targetClientId ? await db_1.prisma.client.findUnique({ where: { id: targetClientId } }) : null;
        await this.reply(ctx, 'Добавление переписки\n\nОтправьте скриншоты одной беседы по порядку от старых сообщений к новым или вставьте текст. Каждый скриншот читается сверху вниз. После паузы 2,5 секунды начну распознавание пачки.\n\nПривязка: ' + (client ? client.name : 'автоматически по телефону / БИН; иначе новый клиент') + '.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('👤 Выбрать клиента', 'attach'), telegraf_1.Markup.button.callback('Автоопределение', 'import:auto')], [telegraf_1.Markup.button.callback('Отмена', 'cancel')]]) });
    }
    async clients(ctx, offset = 0, action) {
        const s = this.session(ctx);
        if (action)
            s.listAction = action;
        const search = (s.search || '').slice(0, 200), digits = search.replace(/\D/g, '');
        const where = search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { company: { contains: search, mode: 'insensitive' } }, { phone: { contains: digits || search } }, { binIin: { contains: search } }] } : {};
        const [clients, total] = await db_1.prisma.$transaction([db_1.prisma.client.findMany({ where, skip: offset, take: 8, orderBy: [{ lastContactAt: 'desc' }, { id: 'asc' }] }), db_1.prisma.client.count({ where })]);
        const rows = clients.map(c => [telegraf_1.Markup.button.callback((s.listAction === 'reply' ? '💡 ' : '👤 ') + c.name.slice(0, 32), (s.listAction === 'reply' ? 'pickreply:' : s.listAction === 'attach' ? 'pickattach:' : 'dossier:') + c.id)]);
        const nav = [];
        if (offset > 0)
            nav.push(telegraf_1.Markup.button.callback('← Назад', 'clients:' + Math.max(0, offset - 8)));
        if (offset + 8 < total)
            nav.push(telegraf_1.Markup.button.callback('Далее →', 'clients:' + (offset + 8)));
        if (nav.length)
            rows.push(nav);
        rows.push([telegraf_1.Markup.button.callback('🔎 Поиск', 'search'), telegraf_1.Markup.button.callback('Сбросить поиск', 'search:clear')], [telegraf_1.Markup.button.callback('Главное меню', 'home')]);
        const summary = clients.map((c, i) => (offset + i + 1) + '. ' + c.name + ' — ' + (labels[c.status] || c.status) + (c.phone ? '\n' + c.phone : '')).join('\n\n');
        await this.reply(ctx, (s.listAction === 'attach' ? 'Выберите клиента для переписки' : s.listAction === 'reply' ? 'Для кого подготовить ответ?' : 'Клиенты') + (search ? '\nПоиск: ' + search : '') + '\n' + (total ? String(offset + 1) + '–' + Math.min(offset + 8, total) + ' из ' + total : 'Ничего не найдено') + '\n\n' + summary, { ...telegraf_1.Markup.inlineKeyboard(rows) });
    }
    async card(ctx, id) {
        const client = await db_1.prisma.client.findUnique({ where: { id }, include: { _count: { select: { conversations: true, deals: true } } } });
        if (!client)
            throw new errors_1.AppError(404, 'Клиент не найден');
        this.session(ctx).activeClientId = id;
        const rows = [
            [telegraf_1.Markup.button.callback('🧩 Интерактивная карточка', 'widget:' + id)],
            [telegraf_1.Markup.button.callback('💡 Что ответить', 'pickreply:' + id)],
            [telegraf_1.Markup.button.callback('📎 Добавить переписку', 'pickattach:' + id), telegraf_1.Markup.button.callback('📊 Изменить статус', 'status:' + id)],
            [telegraf_1.Markup.button.callback('🕘 Последняя переписка', 'history:' + id)],
            [telegraf_1.Markup.button.callback('🗑 Удалить клиента / лид', 'deleteconfirm:' + id)],
        ];
        if (client.phone && /^\d{10,15}$/.test(client.phone))
            rows.push([telegraf_1.Markup.button.url('Написать в WhatsApp', 'https://wa.me/' + client.phone)]);
        rows.push([telegraf_1.Markup.button.callback('💰 Расчёт стоимости', 'price:' + id)]);
        const web = this.webLink('/clients/' + id);
        if (web)
            rows.push([web]);
        rows.push([telegraf_1.Markup.button.callback('← Клиенты', 'clients:0'), telegraf_1.Markup.button.callback('Главное меню', 'home')]);
        await this.reply(ctx, '👤 ' + client.name + '\n🏢 ' + (client.company || 'Компания не указана') + '\n📞 ' + (client.phone || 'Нет телефона') + '\nБИН/ИИН: ' + (client.binIin || '—') + '\nОбъём: ' + (client.estimatedVolume ?? 'не указан') + '\nСтатус: ' + (labels[client.status] || client.status) + '\n\nСитуация: ' + (client.aiSummary || 'Нет сводки').slice(0, 1200) + '\n\nСледующий шаг: ' + (client.aiNextStep || 'Уточнить задачу').slice(0, 800) + '\n\nПереписок: ' + client._count.conversations + ' · Сделок: ' + client._count.deals, { ...telegraf_1.Markup.inlineKeyboard(rows) });
    }
    async sendDashboardWidget(ctx, screen) {
        if (ctx.chat?.type !== 'private')
            return;
        await this.bot.telegram.callApi('sendWidget', {
            chat_id: ctx.chat.id, html: (0, dashboard_widget_1.dashboardWidgetHtml)(screen), allow_queries: true,
            caption: 'TANBOX CRM · интерактивное меню', reply_markup: telegraf_1.Markup.removeKeyboard().reply_markup,
        });
    }
    async handleDashboardQuery(query, answer) {
        const parts = String(query.data).split(':');
        const action = parts[1], id = parts[2];
        const row = (text, action, url, copy) => ({ text, action, url, copy });
        const page = (raw) => Math.min(1000, Math.max(0, Number.parseInt(raw || '0', 10) || 0));
        const fakeCtx = { chat: query.chat, from: query.from, reply: (text, extra) => this.bot.telegram.sendMessage(query.chat.id, text, extra) };
        const later = (task) => { void task.catch(error => console.error('Widget action failed:', this.safeError(error))); };
        if (action === 'close') {
            await answer({ ok: true, notice: 'Закрыто' });
            await this.bot.telegram.deleteMessage(query.chat.id, query.message_id).catch(() => { });
            return;
        }
        if (action === 'home') {
            await answer({ ok: true, title: 'TANBOX CRM', subtitle: 'Клиенты и переписки прямо в Telegram', rows: [
                    row('👥 Клиенты', 'w2:clients:0'), row('📊 Воронка сделок', 'w2:pipeline'), row('📚 База знаний', 'w2:knowledge:0'),
                    row('📸 Загрузить переписку', 'w2:upload'), row('📋 Проверить черновик', 'w2:review'),
                    row('🔐 Вход в веб-панель', 'w2:login'), row('❓ Помощь', 'w2:help'),
                ] });
            return;
        }
        if (action === 'clients') {
            const offset = page(id) * 4;
            const [clients, total] = await db_1.prisma.$transaction([
                db_1.prisma.client.findMany({ skip: offset, take: 4, orderBy: [{ lastContactAt: 'desc' }, { id: 'asc' }], select: { id: true, name: true, status: true } }),
                db_1.prisma.client.count(),
            ]);
            await answer({ ok: true, title: '👥 Клиенты', subtitle: `${total ? offset + 1 : 0}–${Math.min(total, offset + 4)} из ${total}`, rows: [
                    ...clients.map(client => row(client.name.slice(0, 20) + ' · ' + (client_widget_1.widgetStatusLabels[client.status] || client.status), 'w2:card:' + client.id)),
                    ...(offset > 0 ? [row('← Назад', 'w2:clients:' + (page(id) - 1))] : []),
                    ...(offset + 4 < total ? [row('Далее →', 'w2:clients:' + (page(id) + 1))] : []),
                    row('🔎 Найти клиента', 'w2:search'), row('⌂ Главное меню', 'w2:home'),
                ] });
            return;
        }
        if (action === 'pipeline') {
            const groups = await db_1.prisma.deal.groupBy({ by: ['stage'], orderBy: { stage: 'asc' }, _count: true, _sum: { amount: true } });
            await answer({ ok: true, title: '📊 Воронка сделок', subtitle: 'Количество и сумма по этапам', rows: [
                    ...Object.entries(stageLabels).map(([stage, label]) => { const group = groups.find(item => item.stage === stage); return row(`${label}: ${group ? group._count : 0} · ${(group ? group._sum.amount || 0 : 0).toLocaleString('ru-RU')} ₸`); }),
                    row('👥 Открыть клиентов', 'w2:clients:0'), row('⌂ Главное меню', 'w2:home'),
                ] });
            return;
        }
        if (action === 'card' || action === 'more' || action === 'statuses' || action === 'styles' || action === 'set') {
            const clientId = validation_1.idSchema.parse(id);
            if (action === 'set') {
                const status = zod_1.z.enum(validation_1.clientStatuses).parse(parts[3]);
                await db_1.prisma.$transaction(async (tx) => { await tx.client.update({ where: { id: clientId }, data: { status } }); const deal = await tx.deal.findFirst({ where: { clientId: clientId }, orderBy: { updatedAt: 'desc' } }); if (deal)
                    await tx.deal.update({ where: { id: deal.id }, data: { stage: validation_1.statusToStage[status] } }); });
            }
            const client = await db_1.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, company: true, phone: true, status: true, aiNextStep: true } });
            if (!client) {
                await answer({ ok: false, error: 'Клиент не найден' });
                return;
            }
            if (action === 'statuses') {
                await answer({ ok: true, title: 'Статус · ' + client.name.slice(0, 40), rows: [...validation_1.clientStatuses.map(status => row((status === client.status ? '✓ ' : '') + client_widget_1.widgetStatusLabels[status], 'w2:set:' + clientId + ':' + status)), row('← Карточка', 'w2:card:' + clientId)] });
                return;
            }
            if (action === 'styles') {
                await answer({ ok: true, title: 'Ответ клиенту · ' + client.name.slice(0, 35), subtitle: 'Выберите стиль. Ответ придёт сообщением.', rows: [
                        row('Деловой', 'w2:reply:' + clientId + ':BUSINESS'), row('Дружелюбный', 'w2:reply:' + clientId + ':FRIENDLY'),
                        row('Дожим', 'w2:reply:' + clientId + ':CLOSING'), row('Эксперт', 'w2:reply:' + clientId + ':EXPERT'),
                        row('✍️ Свой вопрос', 'w2:question:' + clientId), row('← Карточка', 'w2:card:' + clientId),
                    ] });
                return;
            }
            if (action === 'more') {
                await answer({ ok: true, title: 'Действия · ' + client.name.slice(0, 35), rows: [
                        row('🕘 Последняя переписка', 'w2:history:' + clientId), row('💰 Расчёт стоимости', 'w2:price:' + clientId),
                        ...(client.phone ? [row('📋 Скопировать телефон', undefined, undefined, client.phone)] : []),
                        row('🌐 Открыть в CRM', undefined, env_1.env.APP_ORIGIN + '/clients/' + clientId), row('← Карточка', 'w2:card:' + clientId),
                    ] });
                return;
            }
            await answer({ ok: true, title: '👤 ' + client.name.slice(0, 40), subtitle: (client.company || 'Компания не указана').slice(0, 50) + '\n' + client_widget_1.widgetStatusLabels[client.status] + ' · ' + (client.aiNextStep || 'Уточнить задачу').slice(0, 55), rows: [
                    row('📊 Изменить статус', 'w2:statuses:' + clientId), row('💡 Подготовить ответ', 'w2:styles:' + clientId),
                    row('📎 Добавить переписку', 'w2:attach:' + clientId), row('⋯ Другие действия', 'w2:more:' + clientId),
                    row('← Клиенты', 'w2:clients:0'),
                ] });
            return;
        }
        if (action === 'knowledge') {
            const archive = await (0, archive_service_1.activeArchive)();
            if (!archive) {
                await answer({ ok: true, title: '📚 База знаний', rows: [row('💰 Тарифы TANBOX', 'w2:tariffs'), row('🌐 Интернет-база', 'w2:webkb:0'), row('⌂ Главное меню', 'w2:home')] });
                return;
            }
            const categories = archive.manifest.categories, offset = page(id) * 5;
            await answer({ ok: true, title: '📚 База знаний', subtitle: `Категории ${offset + 1}–${Math.min(categories.length, offset + 5)} из ${categories.length}`, rows: [
                    ...categories.slice(offset, offset + 5).map(item => row(item.title.slice(0, 28), 'w2:docs:' + item.code + ':0')),
                    ...(offset > 0 ? [row('← Назад', 'w2:knowledge:' + (page(id) - 1))] : []),
                    ...(offset + 5 < categories.length ? [row('Далее →', 'w2:knowledge:' + (page(id) + 1))] : []),
                    row('🌐 Интернет-база', 'w2:webkb:0'), row('💰 Тарифы', 'w2:tariffs'), row('⌂ Главное меню', 'w2:home'),
                ] });
            return;
        }
        if (action === 'docs') {
            const archive = await (0, archive_service_1.activeArchive)();
            if (!archive) {
                await answer({ ok: false, error: 'Архив недоступен' });
                return;
            }
            const category = id, valid = category === 'GENERAL' || archive.manifest.categories.some(item => item.code === category);
            if (!valid) {
                await answer({ ok: false, error: 'Категория не найдена' });
                return;
            }
            const current = page(parts[3]), where = { importId: archive.id, language: { in: ['ru', 'mixed'] }, categoryCodes: { has: category } };
            const [docs, total] = await db_1.prisma.$transaction([
                db_1.prisma.knowledgeDocument.findMany({ where, skip: current * 4, take: 4, orderBy: [{ kind: 'asc' }, { title: 'asc' }, { id: 'asc' }], select: { id: true, title: true } }),
                db_1.prisma.knowledgeDocument.count({ where }),
            ]);
            await answer({ ok: true, title: '📚 Материалы', subtitle: `Страница ${current + 1} · документов ${total}`, rows: [
                    ...docs.map(doc => row(doc.title.slice(0, 30), 'w2:doc:' + doc.id)),
                    ...(current > 0 ? [row('← Назад', 'w2:docs:' + category + ':' + (current - 1))] : []),
                    ...(current * 4 + 4 < total ? [row('Далее →', 'w2:docs:' + category + ':' + (current + 1))] : []),
                    row('← Категории', 'w2:knowledge:0'),
                ] });
            return;
        }
        if (action === 'webkb') {
            const overview = await (0, web_service_1.webOverview)(), current = page(id), categories = overview.categories.slice(current * 5, current * 5 + 5);
            await answer({ ok: true, title: '🌐 Интернет-база', subtitle: `Источников ${overview.stats.sources} · проверенных правил ${overview.stats.publishedFacts}`, rows: [
                    ...categories.map(item => row(item.title.slice(0, 28), 'w2:webcat:' + item.code)),
                    ...(current > 0 ? [row('← Назад', 'w2:webkb:' + (current - 1))] : []),
                    ...(current * 5 + 5 < overview.categories.length ? [row('Далее →', 'w2:webkb:' + (current + 1))] : []),
                    row('← База знаний', 'w2:knowledge:0'),
                ] });
            return;
        }
        if (action === 'upload' || action === 'review' || action === 'login' || action === 'help' || action === 'search' || action === 'tariffs' || action === 'doc' || action === 'webcat' || action === 'reply' || action === 'question' || action === 'attach' || action === 'history' || action === 'price') {
            await answer({ ok: true, notice: 'Откройте новое сообщение бота ниже.' });
            if (action === 'upload')
                later(this.importHelp(fakeCtx));
            if (action === 'review')
                later((async () => { const draft = await db_1.prisma.screenshotDraft.findFirst({ where: { telegramUserId: String(query.from.id), expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true } }); if (draft)
                    await this.showScreenshotDraft(fakeCtx, draft.id);
                else
                    await this.reply(fakeCtx, 'Нет переписки, ожидающей проверки. Отправьте скриншоты через «Загрузить переписку».'); })());
            if (action === 'login')
                later(this.login(fakeCtx));
            if (action === 'help')
                later(this.help(fakeCtx));
            if (action === 'search') {
                const session = this.session(fakeCtx);
                session.mode = 'search';
                later(this.reply(fakeCtx, 'Введите имя, телефон, БИН или компанию для поиска. /cancel — отмена.'));
            }
            if (action === 'tariffs')
                later(this.reply(fakeCtx, '💰 Тарифы TANBOX\n\n' + Object.values(knowledge_service_1.TANBOX_KNOWLEDGE.tariffs).join('\n\n')));
            if (action === 'doc')
                later(this.libraryDocument(fakeCtx, validation_1.idSchema.parse(id), 0));
            if (action === 'webcat')
                later(this.webCategory(fakeCtx, id, 0));
            if (action === 'reply')
                later(this.generate(fakeCtx, validation_1.idSchema.parse(id), zod_1.z.enum(['BUSINESS', 'FRIENDLY', 'CLOSING', 'EXPERT']).parse(parts[3])));
            if (action === 'question') {
                const session = this.session(fakeCtx);
                session.activeClientId = validation_1.idSchema.parse(id);
                session.mode = 'question';
                later(this.reply(fakeCtx, 'Напишите, что нужно подготовить для клиента. Например: «Уточни сроки и запроси реквизиты». /cancel — отмена.'));
            }
            if (action === 'attach')
                later(this.importHelp(fakeCtx, validation_1.idSchema.parse(id)));
            if (action === 'history')
                later((async () => { const clientId = validation_1.idSchema.parse(id), chunk = await db_1.prisma.conversationChunk.findFirst({ where: { clientId }, orderBy: { createdAt: 'desc' }, include: { messages: { orderBy: [{ position: 'desc' }, { id: 'desc' }], take: 20 } } }); await this.reply(fakeCtx, chunk ? '🕘 Последняя переписка\n\n' + chunk.messages.reverse().map(message => (message.sender === 'CLIENT' ? 'Клиент: ' : 'Менеджер: ') + message.content).join('\n\n') : 'Переписок пока нет.'); })());
            if (action === 'price')
                later((async () => { const clientId = validation_1.idSchema.parse(id), result = await (0, pricing_service_1.quoteForReply)(clientId); await this.reply(fakeCtx, result.evidence ? (0, pricing_service_1.quoteText)(result.evidence.calculation) : 'Расчёт стоимости пока не подготовлен. Откройте карточку клиента в CRM.'); })());
            return;
        }
        await answer({ ok: false, error: 'Неизвестное действие' });
    }
    async handleWidgetQuery(query) {
        const answer = async (data) => {
            const encoded = JSON.stringify(data);
            await this.bot.telegram.callApi('answerWidgetQuery', { widget_query_id: query.id, data: Buffer.byteLength(encoded) <= 1024 ? encoded : JSON.stringify({ ok: false, error: 'Слишком много данных для виджета' }) });
        };
        try {
            if (!query.chat || query.chat.type !== 'private' || String(query.chat.id) !== String(query.from?.id) || !query.message_id) {
                await answer({ ok: false, error: 'Доступно только в личном чате' });
                return;
            }
            const userId = String(query.from.id);
            if (!(0, access_service_1.isOwner)(query.from.id)) {
                const user = await db_1.prisma.adminUser.findUnique({ where: { telegramChatId: userId } });
                if (!user || !(0, access_service_1.hasAccess)(user)) {
                    await answer({ ok: false, error: 'Доступ к CRM не разрешён' });
                    return;
                }
            }
            if (String(query.data || '').startsWith('w2:')) {
                await this.handleDashboardQuery(query, answer);
                return;
            }
            const match = /^w:(refresh|set):([0-9a-f-]{36})(?::([A-Z_]+))?$/.exec(query.data || '');
            if (!match) {
                await answer({ ok: false, error: 'Неизвестное действие' });
                return;
            }
            const id = validation_1.idSchema.parse(match[2]);
            if (match[1] === 'set') {
                const status = zod_1.z.enum(validation_1.clientStatuses).parse(match[3]);
                await db_1.prisma.$transaction(async (tx) => {
                    await tx.client.update({ where: { id }, data: { status } });
                    const deal = await tx.deal.findFirst({ where: { clientId: id }, orderBy: { updatedAt: 'desc' } });
                    if (deal)
                        await tx.deal.update({ where: { id: deal.id }, data: { stage: validation_1.statusToStage[status] } });
                });
            }
            const client = await db_1.prisma.client.findUnique({ where: { id }, select: { status: true, aiNextStep: true } });
            if (!client) {
                await answer({ ok: false, error: 'Клиент не найден' });
                return;
            }
            await answer({ ok: true, label: client_widget_1.widgetStatusLabels[client.status], next: (client.aiNextStep || 'Уточнить задачу').slice(0, 160) });
        }
        catch (error) {
            if (this.safeError(error).includes('query is too old'))
                return;
            console.error('Widget query failed:', this.safeError(error));
            await answer({ ok: false, error: 'Не удалось обновить карточку' }).catch(() => { });
        }
    }
    async styles(ctx, id) {
        this.session(ctx).activeClientId = id;
        const client = await db_1.prisma.client.findUnique({ where: { id }, select: { name: true } });
        if (!client)
            throw new errors_1.AppError(404, 'Клиент не найден');
        await this.reply(ctx, 'Что ответить клиенту: ' + client.name + '\n\nВыберите стиль или задайте свой вопрос. Будут учтены последние сообщения и база знаний.', { ...telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback('Деловой', 'ai:BUSINESS:' + id), telegraf_1.Markup.button.callback('Дружелюбный', 'ai:FRIENDLY:' + id)],
                [telegraf_1.Markup.button.callback('Дожим', 'ai:CLOSING:' + id), telegraf_1.Markup.button.callback('Эксперт', 'ai:EXPERT:' + id)],
                [telegraf_1.Markup.button.callback('✍ Свой вопрос', 'question:' + id)], [telegraf_1.Markup.button.callback('← Карточка', 'dossier:' + id)],
            ]) });
    }
    async generate(ctx, id, style = 'BUSINESS', userPrompt) {
        const s = this.session(ctx);
        if (s.busy) {
            await this.reply(ctx, 'Уже обрабатываю запрос. Дождитесь результата.');
            return;
        }
        s.busy = true;
        try {
            await this.reply(ctx, 'Готовлю ответ с учётом переписки…');
            const result = await ai_orchestrator_1.aiOrchestrator.generateSuggestedReply({ clientId: id, provider: 'AUTO', style, userPrompt });
            await this.reply(ctx, '💡 Готовый ответ для WhatsApp\n\n' + result.reply + '\n\nПочему такой ответ: ' + result.explanation, { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Ещё вариант', 'pickreply:' + id), telegraf_1.Markup.button.callback('Карточка', 'dossier:' + id)]]) });
        }
        catch (error) {
            await this.reply(ctx, this.userError(error), { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Повторить / выбрать стиль', 'pickreply:' + id)]]) });
        }
        finally {
            s.busy = false;
            s.mode = undefined;
        }
    }
    async pipeline(ctx) {
        const groups = await db_1.prisma.deal.groupBy({ by: ['stage'], orderBy: { stage: 'asc' }, _count: true, _sum: { amount: true } });
        await this.reply(ctx, '📊 Воронка сделок\n\n' + Object.entries(stageLabels).map(([stage, label]) => { const g = groups.find(x => x.stage === stage); return label + ': ' + (g ? g._count : 0) + ' · ' + (g ? g._sum.amount || 0 : 0).toLocaleString('ru-RU') + ' ₸'; }).join('\n') + '\n\nСтатус можно изменить в карточке клиента.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Открыть клиентов', 'clients:0'), telegraf_1.Markup.button.callback('Главное меню', 'home')]]) });
    }
    async knowledge(ctx) {
        const archive = await (0, archive_service_1.activeArchive)();
        if (archive) {
            const manifest = archive.manifest;
            await this.reply(ctx, '📚 База знаний TANBOX\n\nСохранены полные материалы: ' + manifest.coverage.categories + ' категорий, ' + manifest.coverage.documents + ' документов. Выберите направление.\n\nИсходники проекта сохранены полностью; юридическая актуальность проверяется отдельно.', { ...telegraf_1.Markup.inlineKeyboard([
                    [telegraf_1.Markup.button.callback('🌐 Интернет-база и проверенные правила', 'webkb:0')],
                    ...manifest.categories.map((c) => [telegraf_1.Markup.button.callback(c.title, 'kdocs:' + c.code + ':0')]),
                    [telegraf_1.Markup.button.callback('Общие материалы и тарифы', 'kdocs:GENERAL:0')],
                    [telegraf_1.Markup.button.callback('Главное меню', 'home')],
                ]) });
            return;
        }
        const items = await db_1.prisma.knowledgeItem.findMany({ where: { isActive: true }, orderBy: { updatedAt: 'desc' }, take: 8, select: { id: true, title: true } });
        await this.reply(ctx, '📚 База знаний\n\nВыберите тарифы или правило. Активные правила учитываются при подготовке ответа.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('💰 Тарифы TANBOX', 'tariffs')], ...items.map(i => [telegraf_1.Markup.button.callback(i.title.slice(0, 40), 'rule:' + i.id)]), [telegraf_1.Markup.button.callback('Главное меню', 'home')]]) });
    }
    async libraryCategory(ctx, category, page) {
        const batch = await (0, archive_service_1.activeArchive)();
        if (!batch) {
            await this.knowledge(ctx);
            return;
        }
        const categories = batch.manifest.categories;
        if (category !== 'GENERAL' && !categories.some((c) => c.code === category))
            throw new errors_1.AppError(404, 'Категория не найдена');
        const where = { importId: batch.id, language: { in: ['ru', 'mixed'] }, categoryCodes: { has: category } };
        const [docs, total] = await db_1.prisma.$transaction([
            db_1.prisma.knowledgeDocument.findMany({ where, skip: page * 8, take: 8, orderBy: [{ kind: 'asc' }, { title: 'asc' }, { id: 'asc' }], select: { id: true, title: true } }),
            db_1.prisma.knowledgeDocument.count({ where }),
        ]);
        await this.reply(ctx, '📚 ' + (categories.find((c) => c.code === category)?.title || 'Общие материалы') + '\n\nМатериалов: ' + total + '. Страница ' + (page + 1) + '. Каждый текст доступен полностью по страницам.', { ...telegraf_1.Markup.inlineKeyboard([
                ...docs.map(d => [telegraf_1.Markup.button.callback(d.title.slice(0, 55), 'kread:' + d.id + ':0')]),
                [...(page > 0 ? [telegraf_1.Markup.button.callback('← Назад', 'kdocs:' + category + ':' + (page - 1))] : []), ...(page * 8 + 8 < total ? [telegraf_1.Markup.button.callback('Далее →', 'kdocs:' + category + ':' + (page + 1))] : [])],
                [telegraf_1.Markup.button.callback('← Все категории', 'knowledge')],
            ].filter(row => row.length)) });
    }
    async libraryDocument(ctx, id, page) {
        const document = await (0, archive_service_1.archiveDocument)(id);
        const pages = (0, archive_service_1.splitPassages)(document.content, 2800);
        if (page >= pages.length)
            throw new errors_1.AppError(404, 'Страница не найдена');
        await this.reply(ctx, '📄 ' + document.title.slice(0, 200) + '\nСтраница ' + (page + 1) + '/' + pages.length + ' · Материал проекта, требует проверки актуальности.\n\n' + pages[page], { ...telegraf_1.Markup.inlineKeyboard([
                [...(page > 0 ? [telegraf_1.Markup.button.callback('← Назад', 'kread:' + id + ':' + (page - 1))] : []), ...(page + 1 < pages.length ? [telegraf_1.Markup.button.callback('Далее →', 'kread:' + id + ':' + (page + 1))] : [])],
                [telegraf_1.Markup.button.callback('← Материалы категории', 'kdocs:' + (document.categoryCodes[0] || 'GENERAL') + ':0')],
                [telegraf_1.Markup.button.callback('Все категории', 'knowledge')],
            ].filter(row => row.length)) });
    }
    async webKnowledge(ctx, page) {
        const overview = await (0, web_service_1.webOverview)(), categories = overview.categories.slice(page * 8, page * 8 + 8);
        await this.reply(ctx, '🌐 Маркировка в Казахстане\n\nИсточников: ' + overview.stats.sources + '; текстов получено: ' + overview.stats.collected + '; проверенных правил: ' + overview.stats.publishedFacts + '.\nТекст источника и проверенное правило имеют разные статусы.', { ...telegraf_1.Markup.inlineKeyboard([
                ...categories.map(c => [telegraf_1.Markup.button.callback(c.title, 'webcat:' + c.code + ':0')]),
                [...(page > 0 ? [telegraf_1.Markup.button.callback('← Назад', 'webkb:' + (page - 1))] : []), ...(page * 8 + 8 < overview.categories.length ? [telegraf_1.Markup.button.callback('Далее →', 'webkb:' + (page + 1))] : [])],
                [telegraf_1.Markup.button.callback('← База знаний', 'knowledge')],
            ].filter(row => row.length)) });
    }
    async webCategory(ctx, category, page) {
        const sources = await db_1.prisma.webKnowledgeSource.findMany({ where: { categoryCodes: { has: category }, currentRevisionId: { not: null } }, orderBy: [{ priority: 'asc' }, { title: 'asc' }], skip: page * 8, take: 9, select: { title: true, currentRevisionId: true, status: true } });
        const facts = (await (0, web_service_1.usableFacts)()).filter(f => f.categoryCodes.includes(category));
        await this.reply(ctx, '📚 Материалы категории\n\nПроверенных правил: ' + facts.length + '. Выберите правило или исходный документ. Правило содержит ответ, условия и основание.', { ...telegraf_1.Markup.inlineKeyboard([
                ...facts.slice(page * 8, page * 8 + 8).map(f => [telegraf_1.Markup.button.callback('✅ ' + f.title.slice(0, 45), 'webfact:' + f.id + ':0')]),
                ...sources.slice(0, 8).map(s => [telegraf_1.Markup.button.callback((s.status === 'READY' ? '📄 ' : '⚠️ ') + s.title.slice(0, 45), 'webread:' + s.currentRevisionId + ':0')]),
                [...(page > 0 ? [telegraf_1.Markup.button.callback('← Назад', 'webcat:' + category + ':' + (page - 1))] : []), ...(sources.length > 8 || facts.length > (page + 1) * 8 ? [telegraf_1.Markup.button.callback('Далее →', 'webcat:' + category + ':' + (page + 1))] : [])],
                [telegraf_1.Markup.button.callback('Все категории', 'webkb:0')],
            ].filter(row => row.length)) });
    }
    async webRead(ctx, id, page) {
        const document = await db_1.prisma.webKnowledgeRevision.findUnique({ where: { id }, select: { text: true, quality: true, source: { select: { title: true } } } });
        if (!document)
            throw new errors_1.AppError(404, 'Документ не найден');
        const pages = (0, archive_service_1.splitPassages)(document.text || 'Полный текст не извлечён. Сохранённый оригинал доступен в веб-версии CRM.', 2800);
        if (page >= pages.length)
            throw new errors_1.AppError(404, 'Страница не найдена');
        await this.reply(ctx, document.source.title.slice(0, 180) + '\nСтраница ' + (page + 1) + '/' + pages.length + '. Исходный материал, требуется проверка применимости.\n\n' + pages[page], { ...telegraf_1.Markup.inlineKeyboard([
                [...(page > 0 ? [telegraf_1.Markup.button.callback('← Назад', 'webread:' + id + ':' + (page - 1))] : []), ...(page + 1 < pages.length ? [telegraf_1.Markup.button.callback('Далее →', 'webread:' + id + ':' + (page + 1))] : [])],
                [telegraf_1.Markup.button.callback('Все категории', 'webkb:0')],
            ].filter(row => row.length)) });
    }
    async webFact(ctx, id, page) {
        const fact = (await (0, web_service_1.usableFacts)()).find(f => f.id === id);
        if (!fact)
            throw new errors_1.AppError(404, 'Правило требует проверки или больше не опубликовано.');
        const text = fact.title + '\n\n' + fact.answer + '\n\nУсловия: ' + JSON.stringify(fact.conditions) + '\n\nОснования:\n' + fact.evidence.map(e => e.revision.source.title + '\n' + e.locator + '\n' + e.revision.source.url).join('\n\n');
        const pages = (0, archive_service_1.splitPassages)(text, 2800);
        if (page >= pages.length)
            throw new errors_1.AppError(404, 'Страница не найдена');
        await this.reply(ctx, '✅ Проверенное правило · ' + (page + 1) + '/' + pages.length + '\n\n' + pages[page], { ...telegraf_1.Markup.inlineKeyboard([
                [...(page > 0 ? [telegraf_1.Markup.button.callback('← Назад', 'webfact:' + id + ':' + (page - 1))] : []), ...(page + 1 < pages.length ? [telegraf_1.Markup.button.callback('Далее →', 'webfact:' + id + ':' + (page + 1))] : [])],
                [telegraf_1.Markup.button.callback('Категории', 'webkb:0')],
            ].filter(row => row.length)) });
    }
    async processText(ctx, text, targetClientId) {
        const s = this.session(ctx);
        if (s.busy) {
            await this.reply(ctx, 'Уже обрабатываю запрос. Подождите завершения.');
            return;
        }
        s.busy = true;
        s.retryText = { text, targetClientId };
        try {
            await this.reply(ctx, 'Распознаю текст и сохраняю переписку…');
            const result = await ai_orchestrator_1.aiOrchestrator.ingestTextDialogue({ rawText: text, targetClientId, source: 'TELEGRAM_BOT' });
            s.activeClientId = result.client.id;
            s.retryText = undefined;
            s.pendingText = undefined;
            s.targetClientId = undefined;
            s.mode = undefined;
            await this.saved(ctx, result);
        }
        catch (error) {
            await this.reply(ctx, this.userError(error), { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Повторить обработку', 'retry:text')], [telegraf_1.Markup.button.callback('Главное меню', 'home')]]) });
        }
        finally {
            s.busy = false;
        }
    }
    async cancel(ctx) {
        const s = this.session(ctx), key = String(ctx.from.id), batch = this.batches.get(key);
        if (s.busy) {
            await this.reply(ctx, 'Обработка уже началась. Дождитесь результата; новую переписку пока не отправляйте.');
            return;
        }
        if (batch) {
            clearTimeout(batch.timer);
            this.batches.delete(key);
        }
        s.mode = undefined;
        s.pendingText = undefined;
        s.targetClientId = undefined;
        s.reviewEdit = undefined;
        await this.reply(ctx, 'Действие отменено. Выберите пункт меню.');
    }
    registerHandlers() {
        const bot = this.bot;
        bot.use(async (ctx, next) => {
            const query = ctx.update.widget_query;
            if (query) {
                await this.handleWidgetQuery(query);
                return;
            }
            await next();
        });
        bot.use(async (ctx, next) => {
            if (ctx.chat?.type !== 'private' || !ctx.from)
                return;
            const currentUser = await db_1.prisma.adminUser.findUnique({ where: { telegramChatId: String(ctx.from.id) } });
            const start = ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/start');
            if (!(0, access_service_1.isOwner)(ctx.from.id) && (!currentUser || !(0, access_service_1.hasAccess)(currentUser)) && !start) {
                if (ctx.callbackQuery)
                    await ctx.answerCbQuery('Доступ к CRM не разрешён');
                else
                    await ctx.reply('Доступ к CRM не разрешён. Откройте ссылку входа с сайта CRM, чтобы отправить заявку.');
                return;
            }
            const id = String(ctx.from.id), now = Date.now(), isImage = ctx.message && ('photo' in ctx.message || 'document' in ctx.message);
            if (!isImage && now - (this.userRequests.get(id) || 0) < 350) {
                if (ctx.callbackQuery)
                    await ctx.answerCbQuery('Подождите немного');
                return;
            }
            if (!isImage)
                this.userRequests.set(id, now);
            await next();
        });
        bot.use(async (ctx, next) => {
            if (ctx.message && 'text' in ctx.message && Object.values(exports.BOT_LABELS).includes(ctx.message.text))
                await ctx.reply('Нижние кнопки убраны. Откройте интерактивное меню в сообщении бота.', telegraf_1.Markup.removeKeyboard());
            await next();
        });
        bot.command('start', async (ctx) => {
            const payload = ctx.message.text.split(/\s+/)[1] || '';
            if (payload.startsWith('login_')) {
                const id = validation_1.idSchema.safeParse(payload.slice(6));
                if (!id.success) {
                    await this.login(ctx);
                    return;
                }
                const challenge = await db_1.prisma.authCode.findFirst({ where: { id: id.data, isUsed: false, expiresAt: { gt: new Date() } } });
                if (!challenge) {
                    await ctx.reply('Ссылка входа устарела. Откройте CRM и получите новую ссылку.');
                    return;
                }
                if (!(0, access_service_1.isOwner)(ctx.from.id)) {
                    const access = await (0, access_service_1.requestAccess)(String(ctx.from.id), ctx.from.username);
                    if (access.status !== 'APPROVED') {
                        if (access.created && access.user) {
                            const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
                            for (const ownerId of env_1.env.TELEGRAM_ALLOWED_USER_IDS) {
                                try {
                                    await bot.telegram.sendMessage(ownerId, 'Заявка на доступ к TANBOX CRM\n' + name + ' (@' + (ctx.from.username || 'нет username') + ')\nTelegram ID: ' + ctx.from.id, { reply_markup: { inline_keyboard: [[telegraf_1.Markup.button.callback('Одобрить', 'access:approve:' + access.user.id), telegraf_1.Markup.button.callback('Отклонить', 'access:reject:' + access.user.id)]] } });
                                }
                                catch (error) {
                                    console.error('Access notification failed', this.safeError(error));
                                }
                            }
                        }
                        await ctx.reply(access.status === 'PENDING' ? 'Заявка на доступ отправлена владельцу. После одобрения откройте CRM и запросите новую ссылку входа.' : 'Доступ отклонён или отозван. Повторный запрос доступен через 24 часа.');
                        return;
                    }
                }
                try {
                    const code = await (0, auth_service_1.issueCode)(id.data, String(ctx.from.id), ctx.from.username);
                    await this.reply(ctx, '🔐 Код входа: <code>' + code + '</code>\nДействует 5 минут, только для вашего браузера. Никому не передавайте код.\n\nЧтобы работать в боте, выберите действие в меню ниже.', { parse_mode: 'HTML', ...telegraf_1.Markup.inlineKeyboard([[{ text: '📋 Скопировать код', copy_text: { text: code } }]]) });
                }
                catch (error) {
                    await this.reply(ctx, this.userError(error));
                }
                return;
            }
            if (!(0, access_service_1.isOwner)(ctx.from.id)) {
                const user = await db_1.prisma.adminUser.findUnique({ where: { telegramChatId: String(ctx.from.id) } });
                if (!user || !(0, access_service_1.hasAccess)(user)) {
                    await ctx.reply('Откройте страницу входа CRM и перейдите в бот по ссылке, чтобы отправить заявку.');
                    return;
                }
            }
            await this.home(ctx);
        });
        bot.action(/^access:(approve|reject):([0-9a-f-]{36})$/, async (ctx) => {
            if (!(0, access_service_1.isOwner)(ctx.from.id)) {
                await ctx.answerCbQuery('Недостаточно прав');
                return;
            }
            try {
                const user = await (0, access_service_1.decideAccess)(ctx.match[2], String(ctx.from.id), ctx.match[1] === 'approve' ? 'APPROVE' : 'REJECT');
                await ctx.answerCbQuery(ctx.match[1] === 'approve' ? 'Доступ одобрен' : 'Заявка отклонена');
                await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
                await ctx.reply((ctx.match[1] === 'approve' ? 'Одобрен' : 'Отклонён') + ' Telegram ID ' + user.telegramChatId);
                await this.notifyAccess(user.telegramChatId, ctx.match[1] === 'approve' ? 'APPROVE' : 'REJECT');
            }
            catch (error) {
                await ctx.answerCbQuery(this.userError(error));
            }
        });
        bot.command('menu', ctx => this.home(ctx));
        bot.command('help', ctx => this.help(ctx));
        bot.command('cancel', ctx => this.cancel(ctx));
        bot.command('upload', ctx => this.importHelp(ctx));
        bot.command('review', async (ctx) => { const draft = await db_1.prisma.screenshotDraft.findFirst({ where: { telegramUserId: String(ctx.from.id), expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true } }); if (draft)
            await this.showScreenshotDraft(ctx, draft.id);
        else
            await this.reply(ctx, 'Нет переписки, ожидающей проверки. Отправьте скриншоты через «Загрузить переписку».'); });
        bot.command('clients', async (ctx) => { const s = this.session(ctx); s.search = ctx.message.text.split(/\s+/).slice(1).join(' '); if (s.search)
            await this.clients(ctx, 0, 'dossier');
        else
            try {
                await this.sendDashboardWidget(ctx, 'clients:0');
            }
            catch {
                await this.clients(ctx, 0, 'dossier');
            } });
        bot.command('reply', async (ctx) => { const s = this.session(ctx); if (s.activeClientId)
            await this.styles(ctx, s.activeClientId);
        else
            try {
                await this.sendDashboardWidget(ctx, 'clients:0');
            }
            catch {
                await this.clients(ctx, 0, 'reply');
            } });
        bot.command('pipeline', async (ctx) => { try {
            await this.sendDashboardWidget(ctx, 'pipeline');
        }
        catch {
            await this.pipeline(ctx);
        } });
        bot.command('knowledge', async (ctx) => { try {
            await this.sendDashboardWidget(ctx, 'knowledge:0');
        }
        catch {
            await this.knowledge(ctx);
        } });
        bot.command('login', ctx => this.login(ctx));
        bot.command('code', ctx => this.login(ctx));
        bot.hears(exports.BOT_LABELS.upload, ctx => this.importHelp(ctx));
        bot.hears(exports.BOT_LABELS.clients, async (ctx) => { this.session(ctx).search = ''; try {
            await this.sendDashboardWidget(ctx, 'clients:0');
        }
        catch {
            await this.clients(ctx, 0, 'dossier');
        } });
        bot.hears(exports.BOT_LABELS.reply, async (ctx) => { const s = this.session(ctx); if (s.activeClientId)
            await this.styles(ctx, s.activeClientId);
        else
            try {
                await this.sendDashboardWidget(ctx, 'clients:0');
            }
            catch {
                await this.clients(ctx, 0, 'reply');
            } });
        bot.hears(exports.BOT_LABELS.pipeline, async (ctx) => { try {
            await this.sendDashboardWidget(ctx, 'pipeline');
        }
        catch {
            await this.pipeline(ctx);
        } });
        bot.hears(exports.BOT_LABELS.knowledge, async (ctx) => { try {
            await this.sendDashboardWidget(ctx, 'knowledge:0');
        }
        catch {
            await this.knowledge(ctx);
        } });
        bot.hears(exports.BOT_LABELS.login, ctx => this.login(ctx));
        bot.hears(exports.BOT_LABELS.help, ctx => this.help(ctx));
        bot.on('photo', ctx => { const file = ctx.message.photo[ctx.message.photo.length - 1]; this.enqueueImage(ctx, file.file_id, 'image/jpeg'); });
        bot.on('document', async (ctx) => {
            const f = ctx.message.document;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.mime_type || '')) {
                await this.reply(ctx, 'Пришлите PNG, JPG или WEBP.');
                return;
            }
            if ((f.file_size || 0) > files_1.MAX_FILE_BYTES) {
                await this.reply(ctx, 'Файл слишком большой: допустимо до 10 МБ.');
                return;
            }
            this.enqueueImage(ctx, f.file_id, f.mime_type);
        });
        bot.on('text', async (ctx) => {
            const text = ctx.message.text.trim();
            if (text.startsWith('/')) {
                await this.help(ctx);
                return;
            }
            if (text.length > 50000) {
                await this.reply(ctx, 'Переписка должна быть до 50 000 символов. Разделите её на части.');
                return;
            }
            const s = this.session(ctx);
            if (s.reviewEdit) {
                const edit = s.reviewEdit;
                if (!text) {
                    await this.reply(ctx, 'Пришлите непустой текст.');
                    return;
                }
                const limit = edit.field === 'content' ? 10000 : edit.field === 'summary' ? 5000 : 2000;
                if (text.length > limit) {
                    await this.reply(ctx, 'Слишком длинный текст: максимум ' + limit + ' символов.');
                    return;
                }
                await (0, screenshot_drafts_service_1.updateTelegramScreenshotDraft)(edit.draftId, String(ctx.from.id), parsed => {
                    if (edit.field === 'content') {
                        if (edit.index === undefined || !parsed.messages[edit.index])
                            throw new errors_1.AppError(404, 'Сообщение не найдено');
                        const messages = [...parsed.messages];
                        messages[edit.index] = { ...messages[edit.index], content: text };
                        return { ...parsed, messages };
                    }
                    return { ...parsed, [edit.field]: text };
                });
                s.reviewEdit = undefined;
                await this.showScreenshotDraft(ctx, edit.draftId, Math.floor((edit.index || 0) / 6));
                return;
            }
            if (s.mode === 'search') {
                s.search = text;
                s.mode = undefined;
                await this.clients(ctx, 0);
                return;
            }
            if (s.mode === 'question' && s.activeClientId) {
                await this.generate(ctx, s.activeClientId, 'BUSINESS', text);
                return;
            }
            if (s.mode === 'import') {
                await this.processText(ctx, text, s.targetClientId);
                return;
            }
            s.pendingText = text;
            const rows = [[telegraf_1.Markup.button.callback('💾 Сохранить как переписку', 'confirm:text')]];
            if (s.activeClientId)
                rows.push([telegraf_1.Markup.button.callback('💡 Вопрос по активному клиенту', 'confirm:question')]);
            rows.push([telegraf_1.Markup.button.callback('Отмена', 'cancel')]);
            await this.reply(ctx, 'Получил текст. Что с ним сделать?', { ...telegraf_1.Markup.inlineKeyboard(rows) });
        });
        bot.action('home', async (ctx) => { await ctx.answerCbQuery(); await this.home(ctx); });
        bot.action('cancel', async (ctx) => { await ctx.answerCbQuery(); await this.cancel(ctx); });
        bot.action('import:auto', async (ctx) => { await ctx.answerCbQuery(); await this.importHelp(ctx); });
        bot.action('attach', async (ctx) => { await ctx.answerCbQuery(); this.session(ctx).search = ''; await this.clients(ctx, 0, 'attach'); });
        bot.action('search', async (ctx) => { await ctx.answerCbQuery(); this.session(ctx).mode = 'search'; await this.reply(ctx, 'Введите имя, телефон, БИН или компанию для поиска. /cancel — отмена.'); });
        bot.action('search:clear', async (ctx) => { await ctx.answerCbQuery(); this.session(ctx).search = ''; await this.clients(ctx, 0); });
        bot.action(/^clients:(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); await this.clients(ctx, Math.min(1e7, Number(ctx.match[1]))); });
        bot.action(/^widget:([0-9a-f-]{36})$/, async (ctx) => {
            await ctx.answerCbQuery();
            try {
                await this.sendDashboardWidget(ctx, 'card:' + validation_1.idSchema.parse(ctx.match[1]));
            }
            catch (error) {
                console.error('Widget send failed:', this.safeError(error));
                await this.reply(ctx, 'Не удалось открыть интерактивную карточку. Обычная карточка доступна выше.');
            }
        });
        bot.action('close', async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(() => ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => { })); });
        bot.action(/^(dossier|pickreply|pickattach|question|history|status|price):(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const action = ctx.match[1], id = validation_1.idSchema.parse(ctx.match[2]), s = this.session(ctx);
            if (action === 'dossier') {
                await this.card(ctx, id);
                return;
            }
            if (action === 'pickreply') {
                await this.styles(ctx, id);
                return;
            }
            if (action === 'price') {
                const result = await (0, pricing_service_1.quoteForReply)(id), web = this.webLink('/clients/' + id + '?tab=pricing');
                await this.reply(ctx, result.evidence ? (0, pricing_service_1.quoteText)(result.evidence.calculation) : 'Расчёт стоимости пока не подготовлен или требует обновления. Откройте веб-карточку клиента → «Расчёт стоимости».', {
                    ...telegraf_1.Markup.inlineKeyboard([...(web ? [[web]] : []), [telegraf_1.Markup.button.callback('💡 Подготовить ответ', 'pickreply:' + id)], [telegraf_1.Markup.button.callback('← Карточка', 'dossier:' + id)]])
                });
                return;
            }
            if (action === 'pickattach') {
                await this.importHelp(ctx, id);
                return;
            }
            if (action === 'question') {
                s.activeClientId = id;
                s.mode = 'question';
                await this.reply(ctx, 'Напишите, что нужно подготовить для клиента. Например: «Уточни сроки и запроси реквизиты». /cancel — отмена.');
                return;
            }
            if (action === 'history') {
                const chunk = await db_1.prisma.conversationChunk.findFirst({ where: { clientId: id }, orderBy: { createdAt: 'desc' }, include: { messages: { orderBy: [{ position: 'desc' }, { id: 'desc' }], take: 20 } } });
                await this.reply(ctx, chunk ? '🕘 Последняя переписка\n\n' + chunk.messages.reverse().map(m => (m.sender === 'CLIENT' ? 'Клиент: ' : 'Менеджер: ') + m.content).join('\n\n') : 'Переписок пока нет.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('← Карточка', 'dossier:' + id)]]) });
                return;
            }
            await this.reply(ctx, 'Выберите новый статус клиента:', { ...telegraf_1.Markup.inlineKeyboard(validation_1.clientStatuses.map(status => [telegraf_1.Markup.button.callback(labels[status], 'setstatus:' + status + ':' + id)])) });
        });
        bot.action(/^setstatus:([A-Z_]+):(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const status = zod_1.z.enum(validation_1.clientStatuses).parse(ctx.match[1]), id = validation_1.idSchema.parse(ctx.match[2]);
            await db_1.prisma.$transaction(async (tx) => { await tx.client.update({ where: { id }, data: { status } }); const d = await tx.deal.findFirst({ where: { clientId: id }, orderBy: { updatedAt: 'desc' } }); if (d)
                await tx.deal.update({ where: { id: d.id }, data: { stage: validation_1.statusToStage[status] } }); });
            await this.card(ctx, id);
        });
        bot.action(/^ai:(BUSINESS|FRIENDLY|CLOSING|EXPERT):(.+)$/, async (ctx) => { await ctx.answerCbQuery(); await this.generate(ctx, validation_1.idSchema.parse(ctx.match[2]), ctx.match[1]); });
        bot.action(/^(reply|closing):(.+)$/, async (ctx) => { await ctx.answerCbQuery(); const id = validation_1.idSchema.parse(ctx.match[2]); if (ctx.match[1] === 'closing')
            await this.generate(ctx, id, 'CLOSING');
        else
            await this.styles(ctx, id); });
        bot.action('confirm:text', async (ctx) => { await ctx.answerCbQuery(); const s = this.session(ctx); if (!s.pendingText) {
            await this.reply(ctx, 'Текст уже обработан. Отправьте новую переписку.');
            return;
        } await this.processText(ctx, s.pendingText, s.targetClientId); });
        bot.action('confirm:question', async (ctx) => { await ctx.answerCbQuery(); const s = this.session(ctx); if (s.activeClientId && s.pendingText) {
            const text = s.pendingText;
            s.pendingText = undefined;
            await this.generate(ctx, s.activeClientId, 'BUSINESS', text);
        } });
        bot.action('retry:text', async (ctx) => { await ctx.answerCbQuery(); const s = this.session(ctx); if (s.retryText)
            await this.processText(ctx, s.retryText.text, s.retryText.targetClientId);
        else
            await this.importHelp(ctx); });
        bot.action('retry:images', async (ctx) => { await ctx.answerCbQuery(); const s = this.session(ctx); if (!s.retryImages) {
            await this.importHelp(ctx);
            return;
        } if (s.busy) {
            await this.reply(ctx, 'Обработка ещё идёт.');
            return;
        } const key = String(ctx.from.id); this.batches.set(key, { ctx, files: s.retryImages.files, targetClientId: s.retryImages.targetClientId, timer: undefined }); await this.processBatch(key); });
        bot.action(/^sr:page:([0-9a-f-]{36}):(\d{1,3})$/, async (ctx) => { await ctx.answerCbQuery(); await this.showScreenshotDraft(ctx, validation_1.idSchema.parse(ctx.match[1]), Number(ctx.match[2])); });
        bot.action(/^sr:msg:([0-9a-f-]{36}):(\d{1,3})$/, async (ctx) => { await ctx.answerCbQuery(); await this.showScreenshotMessage(ctx, validation_1.idSchema.parse(ctx.match[1]), Number(ctx.match[2])); });
        bot.action(/^sr:role:([0-9a-f-]{36}):(\d{1,3}):([CM])$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]), index = Number(ctx.match[2]), sender = ctx.match[3] === 'C' ? 'CLIENT' : 'MANAGER';
            await (0, screenshot_drafts_service_1.updateTelegramScreenshotDraft)(id, String(ctx.from.id), parsed => { if (!parsed.messages[index])
                throw new errors_1.AppError(404, 'Сообщение не найдено'); const messages = [...parsed.messages]; messages[index] = { ...messages[index], sender, senderName: undefined }; return { ...parsed, messages }; });
            await this.showScreenshotMessage(ctx, id, index);
        });
        bot.action(/^sr:move:([0-9a-f-]{36}):(\d{1,3}):([ud])$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]), index = Number(ctx.match[2]), target = index + (ctx.match[3] === 'u' ? -1 : 1);
            const updated = await (0, screenshot_drafts_service_1.updateTelegramScreenshotDraft)(id, String(ctx.from.id), parsed => { if (!parsed.messages[index])
                throw new errors_1.AppError(404, 'Сообщение не найдено'); if (target < 0 || target >= parsed.messages.length)
                return parsed; const messages = [...parsed.messages]; [messages[index], messages[target]] = [messages[target], messages[index]]; return { ...parsed, messages }; });
            await this.showScreenshotMessage(ctx, id, target < 0 || target >= updated.messages.length ? index : target);
        });
        bot.action(/^sr:del:([0-9a-f-]{36}):(\d{1,3})$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]), index = Number(ctx.match[2]);
            await (0, screenshot_drafts_service_1.updateTelegramScreenshotDraft)(id, String(ctx.from.id), parsed => { if (!parsed.messages[index])
                throw new errors_1.AppError(404, 'Сообщение не найдено'); if (parsed.messages.length === 1)
                throw new errors_1.AppError(400, 'Нельзя удалить последнее сообщение'); return { ...parsed, messages: parsed.messages.filter((_, i) => i !== index) }; });
            await this.showScreenshotDraft(ctx, id, Math.floor(index / 6));
        });
        bot.action(/^sr:text:([0-9a-f-]{36}):(\d{1,3})$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]), index = Number(ctx.match[2]), draft = await (0, screenshot_drafts_service_1.getTelegramScreenshotDraft)(id, String(ctx.from.id));
            if (!gemini_service_1.parsedConversationSchema.parse(draft.parsed).messages[index])
                throw new errors_1.AppError(404, 'Сообщение не найдено');
            this.session(ctx).reviewEdit = { draftId: id, index, field: 'content' };
            await this.reply(ctx, 'Отправьте исправленный текст сообщения ' + (index + 1) + ' одним сообщением. /cancel — выйти из правки.');
        });
        bot.action(/^sr:(summary|next):([0-9a-f-]{36})$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[2]);
            await (0, screenshot_drafts_service_1.getTelegramScreenshotDraft)(id, String(ctx.from.id));
            this.session(ctx).reviewEdit = { draftId: id, field: ctx.match[1] === 'summary' ? 'summary' : 'nextStep' };
            await this.reply(ctx, ctx.match[1] === 'summary' ? 'Отправьте исправленную сводку переписки.' : 'Отправьте исправленный следующий шаг.');
        });
        bot.action(/^sr:save:([0-9a-f-]{36})$/, async (ctx) => {
            await ctx.answerCbQuery();
            const s = this.session(ctx);
            if (s.busy) {
                await this.reply(ctx, 'Сохранение уже идёт.');
                return;
            }
            s.busy = true;
            try {
                const result = await (0, screenshot_drafts_service_1.commitTelegramScreenshotDraft)(validation_1.idSchema.parse(ctx.match[1]), String(ctx.from.id));
                s.reviewEdit = undefined;
                s.activeClientId = result.client.id;
                await this.saved(ctx, result);
            }
            finally {
                s.busy = false;
            }
        });
        bot.action(/^sr:cancel:([0-9a-f-]{36})$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]), s = this.session(ctx);
            if (s.busy) {
                await this.reply(ctx, 'Дождитесь завершения сохранения.');
                return;
            }
            await (0, screenshot_drafts_service_1.discardScreenshotDraft)(id, String(ctx.from.id));
            s.reviewEdit = undefined;
            await this.reply(ctx, 'Черновик и его скриншоты удалены. Данные в CRM не добавлены.');
        });
        bot.action(/^deleteconfirm:(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]);
            const client = await db_1.prisma.client.findUnique({ where: { id }, select: { name: true } });
            if (!client) {
                await this.reply(ctx, 'Клиент уже удалён.');
                return;
            }
            await this.reply(ctx, 'Удалить «' + client.name + '» полностью?\n\nБудут удалены клиент / лид, все его сделки, переписка, AI-подсказки и скриншоты. Отменить действие в CRM нельзя.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Удалить полностью', 'deleteclient:' + id)], [telegraf_1.Markup.button.callback('Отмена — к карточке', 'dossier:' + id)]]) });
        });
        bot.action(/^deleteclient:(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const id = validation_1.idSchema.parse(ctx.match[1]), s = this.session(ctx);
            if (s.busy) {
                await this.reply(ctx, 'Дождитесь завершения текущей обработки перед удалением.');
                return;
            }
            const result = await (0, client_deletion_service_1.deleteClientCompletely)(id);
            if (s.activeClientId === id)
                s.activeClientId = undefined;
            if (s.targetClientId === id)
                s.targetClientId = undefined;
            if (s.retryText?.targetClientId === id)
                s.retryText = undefined;
            if (s.retryImages?.targetClientId === id)
                s.retryImages = undefined;
            const key = String(ctx.from.id), batch = this.batches.get(key);
            if (batch?.targetClientId === id) {
                clearTimeout(batch.timer);
                this.batches.delete(key);
            }
            await this.reply(ctx, result.cleanupPending ? 'Клиент удалён. ' + result.cleanupPending + ' скриншотов ожидают повторной очистки и уже недоступны в CRM.' : 'Клиент, сделки, переписка и скриншоты удалены.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('К списку клиентов', 'clients:0')]]) });
        });
        bot.action('tariffs', async (ctx) => { await ctx.answerCbQuery(); await this.reply(ctx, '💰 Тарифы TANBOX\n\n' + Object.values(knowledge_service_1.TANBOX_KNOWLEDGE.tariffs).join('\n\n'), { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('← База знаний', 'knowledge')]]) }); });
        bot.action('knowledge', async (ctx) => { await ctx.answerCbQuery(); await this.knowledge(ctx); });
        bot.action(/^kdocs:([a-zA-Z_]+):(\d{1,5})$/, async (ctx) => { await ctx.answerCbQuery(); await this.libraryCategory(ctx, ctx.match[1], Number(ctx.match[2])); });
        bot.action(/^kread:([0-9a-f-]+):(\d{1,5})$/, async (ctx) => { await ctx.answerCbQuery(); await this.libraryDocument(ctx, validation_1.idSchema.parse(ctx.match[1]), Number(ctx.match[2])); });
        bot.action(/^webkb:(\d{1,5})$/, async (ctx) => { await ctx.answerCbQuery(); await this.webKnowledge(ctx, Number(ctx.match[1])); });
        bot.action(/^webcat:([a-zA-Z_]+):(\d{1,5})$/, async (ctx) => { await ctx.answerCbQuery(); await this.webCategory(ctx, ctx.match[1], Number(ctx.match[2])); });
        bot.action(/^webread:([0-9a-f-]+):(\d{1,5})$/, async (ctx) => { await ctx.answerCbQuery(); await this.webRead(ctx, validation_1.idSchema.parse(ctx.match[1]), Number(ctx.match[2])); });
        bot.action(/^webfact:([0-9a-f-]+):(\d{1,5})$/, async (ctx) => { await ctx.answerCbQuery(); await this.webFact(ctx, validation_1.idSchema.parse(ctx.match[1]), Number(ctx.match[2])); });
        bot.action(/^rule:(.+)$/, async (ctx) => { await ctx.answerCbQuery(); const item = await db_1.prisma.knowledgeItem.findFirst({ where: { id: validation_1.idSchema.parse(ctx.match[1]), isActive: true } }); await this.reply(ctx, item ? item.title + '\n\n' + item.content : 'Правило не найдено.', { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('← База знаний', 'knowledge')]]) }); });
        bot.catch(async (error, ctx) => { console.warn('Telegram handler failed:', this.safeError(error)); await this.reply(ctx, this.userError(error)).catch(() => { }); });
    }
    async saved(ctx, result) {
        try {
            await this.reply(ctx, (result.duplicate ? 'Эта переписка уже была сохранена.' : '✅ Переписка сохранена, сделка добавлена в CRM.') + '\n\nКлиент: ' + result.client.name + '\n' + result.parsed.summary + '\n\nСледующий шаг: ' + result.parsed.nextStep, { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('💡 Что ответить', 'pickreply:' + result.client.id)], [telegraf_1.Markup.button.callback('Открыть карточку', 'dossier:' + result.client.id), telegraf_1.Markup.button.callback('Добавить переписку', 'pickattach:' + result.client.id)]]) });
        }
        catch {
            console.warn('Telegram result notification failed after successful save');
        }
    }
    async showScreenshotDraft(ctx, id, page = 0) {
        const draft = await (0, screenshot_drafts_service_1.getTelegramScreenshotDraft)(id, String(ctx.from.id));
        const parsed = gemini_service_1.parsedConversationSchema.parse(draft.parsed), pages = Math.ceil(parsed.messages.length / 6);
        const current = Math.max(0, Math.min(page, pages - 1)), start = current * 6;
        const lines = parsed.messages.slice(start, start + 6).map((m, i) => `${start + i + 1}. ${m.sender === 'CLIENT' ? '👤 Клиент' : '🧑‍💼 Я'}${m.time ? ' · ' + m.time : ''}\n${m.content.slice(0, 350)}${m.content.length > 350 ? '…' : ''}`);
        const rows = parsed.messages.slice(start, start + 6).map((_, i) => [telegraf_1.Markup.button.callback(`✏️ Сообщение ${start + i + 1}`, 'sr:msg:' + id + ':' + (start + i))]);
        const nav = [];
        if (current > 0)
            nav.push(telegraf_1.Markup.button.callback('← Раньше', 'sr:page:' + id + ':' + (current - 1)));
        if (current + 1 < pages)
            nav.push(telegraf_1.Markup.button.callback('Позже →', 'sr:page:' + id + ':' + (current + 1)));
        if (nav.length)
            rows.push(nav);
        rows.push([telegraf_1.Markup.button.callback('✍️ Исправить сводку', 'sr:summary:' + id), telegraf_1.Markup.button.callback('✍️ Следующий шаг', 'sr:next:' + id)]);
        rows.push([telegraf_1.Markup.button.callback('✅ Сохранить в CRM', 'sr:save:' + id)]);
        rows.push([telegraf_1.Markup.button.callback('❌ Удалить черновик', 'sr:cancel:' + id)]);
        await this.reply(ctx, `📋 Черновик переписки · ${current + 1}/${pages}\nКлиент: ${parsed.clientName}${parsed.phone ? ' · ' + parsed.phone : ''}\n\n${lines.join('\n\n')}\n\nСводка: ${parsed.summary.slice(0, 350)}\nСледующий шаг: ${parsed.nextStep.slice(0, 250)}\n\nПроверьте каждое сообщение перед сохранением. Черновик действует 30 минут.`, { ...telegraf_1.Markup.inlineKeyboard(rows) });
    }
    async showScreenshotMessage(ctx, id, index) {
        const draft = await (0, screenshot_drafts_service_1.getTelegramScreenshotDraft)(id, String(ctx.from.id));
        const parsed = gemini_service_1.parsedConversationSchema.parse(draft.parsed), message = parsed.messages[index];
        if (!message)
            throw new errors_1.AppError(404, 'Сообщение не найдено');
        const rows = [
            [telegraf_1.Markup.button.callback('👤 Клиент', 'sr:role:' + id + ':' + index + ':C'), telegraf_1.Markup.button.callback('🧑‍💼 Я', 'sr:role:' + id + ':' + index + ':M')],
            [telegraf_1.Markup.button.callback('✍️ Исправить текст', 'sr:text:' + id + ':' + index)],
            [telegraf_1.Markup.button.callback('⬆️ Раньше', 'sr:move:' + id + ':' + index + ':u'), telegraf_1.Markup.button.callback('⬇️ Позже', 'sr:move:' + id + ':' + index + ':d')],
            [telegraf_1.Markup.button.callback('🗑 Удалить лишнее', 'sr:del:' + id + ':' + index)],
            [telegraf_1.Markup.button.callback('← К списку', 'sr:page:' + id + ':' + Math.floor(index / 6))],
        ];
        await this.reply(ctx, `Сообщение ${index + 1}/${parsed.messages.length}\nАвтор: ${message.sender === 'CLIENT' ? 'клиент' : 'я / менеджер'}\nВремя: ${message.time || 'не указано'}\n\n${message.content}`, { ...telegraf_1.Markup.inlineKeyboard(rows) });
    }
    enqueueImage(ctx, id, mime) {
        const key = String(ctx.from.id), s = this.session(ctx);
        if (s.busy) {
            void this.reply(ctx, 'Обработка предыдущего запроса ещё идёт. Отправьте новую пачку после результата.').catch(() => { });
            return;
        }
        let batch = this.batches.get(key);
        if (batch) {
            if (batch.files.length >= files_1.MAX_FILES) {
                void this.reply(ctx, 'В одной пачке до 15 изображений.').catch(() => { });
                return;
            }
            clearTimeout(batch.timer);
            batch.files.push({ id, mime, messageId: ctx.message?.message_id });
        }
        else {
            batch = { ctx, files: [{ id, mime, messageId: ctx.message?.message_id }], targetClientId: s.targetClientId, timer: undefined };
            this.batches.set(key, batch);
            void this.reply(ctx, '📥 Получаю скриншоты. Пришлите остальные изображения этой беседы; после короткой паузы начну распознавание.').catch(() => { });
        }
        batch.timer = setTimeout(() => { void this.processBatch(key).catch(() => console.warn('Telegram batch failed')); }, 2500);
    }
    async processBatch(key) {
        const batch = this.batches.get(key);
        if (!batch)
            return;
        const s = this.session(batch.ctx);
        if (s.busy) {
            batch.timer = setTimeout(() => void this.processBatch(key), 2000);
            return;
        }
        this.batches.delete(key);
        s.busy = true;
        s.retryImages = { files: batch.files, targetClientId: batch.targetClientId };
        let images = [];
        try {
            await this.reply(batch.ctx, '🔎 Распознаю ' + batch.files.length + ' изображений…');
            const inputs = [];
            let total = 0;
            for (const file of [...batch.files].sort((a, b) => (a.messageId || 0) - (b.messageId || 0))) {
                const link = await this.bot.telegram.getFileLink(file.id);
                const response = await fetch(link.href, { signal: AbortSignal.timeout(15000) });
                if (!response.ok)
                    throw new errors_1.AppError(502, 'Не удалось скачать изображение из Telegram');
                const reader = response.body.getReader(), chunks = [];
                let size = 0;
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done)
                            break;
                        size += value.length;
                        total += value.length;
                        if (size > files_1.MAX_FILE_BYTES || total > files_1.MAX_TOTAL_BYTES)
                            throw new errors_1.AppError(413, 'Допускается до 10 МБ на файл, до 40 МБ суммарно');
                        chunks.push(value);
                    }
                }
                finally {
                    await reader.cancel().catch(() => { });
                }
                inputs.push({ buffer: Buffer.concat(chunks), mimeType: file.mime });
            }
            images = await (0, files_1.prepareImages)(inputs);
            const preview = await ai_orchestrator_1.aiOrchestrator.previewScreenshots({ images, targetClientId: batch.targetClientId, source: 'TELEGRAM_BOT' });
            if (preview.duplicate && preview.result) {
                await (0, files_1.deleteImages)(images.map(i => i.url));
                images = [];
                s.retryImages = undefined;
                s.targetClientId = undefined;
                s.mode = undefined;
                s.activeClientId = preview.result.client.id;
                await this.saved(batch.ctx, preview.result);
            }
            else if (preview.parsed && preview.reviewToken) {
                const draft = await (0, screenshot_drafts_service_1.createTelegramScreenshotDraft)(key, images, preview.parsed, preview.reviewToken, batch.targetClientId);
                images = [];
                s.retryImages = undefined;
                s.targetClientId = undefined;
                s.mode = undefined;
                await this.showScreenshotDraft(batch.ctx, draft.id);
            }
            else
                throw new errors_1.AppError(502, 'Не удалось подготовить черновик переписки');
        }
        catch (error) {
            await (0, files_1.deleteImages)(images.map(i => i.url));
            await this.reply(batch.ctx, this.userError(error), { ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Повторить эту пачку', 'retry:images')], [telegraf_1.Markup.button.callback('Главное меню', 'home')]]) }).catch(() => { });
        }
        finally {
            s.busy = false;
        }
    }
    async acquireLease() {
        await db_1.prisma.systemSetting.upsert({ where: { key: this.leaseKey }, create: { key: this.leaseKey, value: '' }, update: {} });
        const old = await db_1.prisma.systemSetting.findUniqueOrThrow({ where: { key: this.leaseKey } });
        let value = {};
        try {
            value = JSON.parse(old.value || '{}');
        }
        catch { }
        if (value.owner !== this.owner && (value.expires || 0) > Date.now())
            return false;
        const update = await db_1.prisma.systemSetting.updateMany({ where: { key: this.leaseKey, value: old.value }, data: { value: JSON.stringify({ owner: this.owner, expires: Date.now() + 45000 }) } });
        return update.count === 1;
    }
    scheduleRetry() {
        if (this.retryTimer)
            clearTimeout(this.retryTimer);
        if (!this.stopping)
            this.retryTimer = setTimeout(() => void this.start(), 60000);
    }
    async start() {
        if (!this.bot || !env_1.env.TELEGRAM_POLLING) {
            this.state = this.bot ? 'disabled' : 'unconfigured';
            return;
        }
        if (this.running || this.starting || this.stopping)
            return;
        this.starting = true;
        if (this.retryTimer)
            clearTimeout(this.retryTimer);
        try {
            if (!await this.acquireLease()) {
                this.state = 'another-instance';
                this.starting = false;
                this.scheduleRetry();
                return;
            }
            this.state = 'connecting';
            this.leaseTimer = setInterval(() => { void this.acquireLease().then(ok => { if (!ok)
                throw new Error('lease lost'); }).catch(() => { this.running = false; this.starting = false; this.state = 'unavailable'; if (this.leaseTimer)
                clearInterval(this.leaseTimer); try {
                this.bot.stop('Lease lost');
            }
            catch { } this.scheduleRetry(); }); }, 15000);
            await this.bot.telegram.setMyCommands([{ command: 'menu', description: 'Главное меню' }, { command: 'upload', description: 'Добавить переписку' }, { command: 'review', description: 'Проверить скриншоты' }, { command: 'clients', description: 'Клиенты и поиск' }, { command: 'reply', description: 'Что ответить клиенту' }, { command: 'pipeline', description: 'Воронка сделок' }, { command: 'knowledge', description: 'Тарифы и база знаний' }, { command: 'login', description: 'Вход в веб-панель' }, { command: 'help', description: 'Как пользоваться' }]).catch(() => console.warn('Cannot update bot command menu'));
            this.bot.launch({ dropPendingUpdates: false, allowedUpdates: ['message', 'callback_query', 'widget_query'] }, () => { this.state = 'connecting'; }).catch(error => {
                this.running = false;
                this.starting = false;
                this.state = (error?.response?.error_code || error?.code) === 409 ? 'conflict' : 'unavailable';
                console.warn('Telegram polling unavailable:', this.safeError(error));
                if (this.leaseTimer)
                    clearInterval(this.leaseTimer);
                this.scheduleRetry();
            });
        }
        catch (error) {
            this.starting = false;
            this.state = 'unavailable';
            console.warn('Telegram startup unavailable:', this.safeError(error));
            this.scheduleRetry();
        }
    }
    async stop() {
        this.stopping = true;
        if (this.retryTimer)
            clearTimeout(this.retryTimer);
        if (this.leaseTimer)
            clearInterval(this.leaseTimer);
        for (const batch of this.batches.values())
            clearTimeout(batch.timer);
        this.batches.clear();
        try {
            this.bot?.stop('Shutdown');
        }
        catch { }
        this.running = false;
        this.state = 'stopped';
        const old = await db_1.prisma.systemSetting.findUnique({ where: { key: this.leaseKey } });
        if (old) {
            let value;
            try {
                value = JSON.parse(old.value);
            }
            catch { }
            if (value?.owner === this.owner)
                await db_1.prisma.systemSetting.updateMany({ where: { key: this.leaseKey, value: old.value }, data: { value: '' } });
        }
    }
}
exports.TelegramBotService = TelegramBotService;
exports.telegramBotService = new TelegramBotService();

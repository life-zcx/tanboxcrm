import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { prisma } from '../config/db';
import { normalizePhone } from '../lib/validation';

export type WhatsAppStatus = 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED';

interface BufferedMessage {
  id?: string;
  sender: 'CLIENT' | 'MANAGER';
  senderName?: string;
  content: string;
  timestamp: Date;
}

export interface WhatsAppSyncStats {
  isSyncing: boolean;
  lastSyncAt: string | null;
  importedChats: number;
  importedMessages: number;
}

export interface WhatsAppFeedItem {
  id: string;
  phone: string;
  sender: 'CLIENT' | 'MANAGER';
  senderName?: string;
  content: string;
  timestamp: string;
  clientName?: string;
}

export class WhatsAppService {
  private sock: WASocket | null = null;
  private status: WhatsAppStatus = 'DISCONNECTED';
  private qrDataUrl: string | null = null;
  private connectedUser: { phone?: string; name?: string } | null = null;
  private lastError: string | null = null;
  private authDir = path.resolve(process.cwd(), 'data', 'whatsapp-auth');
  private reconnectTimer?: NodeJS.Timeout;
  private isExplicitLogout = false;
  private isStarting = false;
  private processedWaMessageIds = new Set<string>();

  private syncStats: WhatsAppSyncStats = {
    isSyncing: false,
    lastSyncAt: null,
    importedChats: 0,
    importedMessages: 0,
  };

  private settings = {
    autoCreateLeads: true,
    autoRunAi: false,
  };

  private liveFeed: WhatsAppFeedItem[] = [];
  private buffers = new Map<string, { timer: NodeJS.Timeout; messages: BufferedMessage[]; pushName?: string }>();
  private lidToPhoneMap = new Map<string, string>();

  constructor() {
    this.loadLidMappings();
  }

  // Загрузка сопоставлений LID -> реальный номер телефона из сессии Baileys
  private loadLidMappings(): number {
    try {
      if (!fsSync.existsSync(this.authDir)) return 0;
      const files = fsSync.readdirSync(this.authDir);
      let count = 0;
      for (const f of files) {
        if (f.startsWith('lid-mapping-') && f.endsWith('_reverse.json')) {
          const lidUser = f.replace('lid-mapping-', '').replace('_reverse.json', '');
          try {
            const raw = fsSync.readFileSync(path.join(this.authDir, f), 'utf8');
            const phone = JSON.parse(raw);
            if (phone) {
              const clean = String(phone).replace(/\D/g, '');
              this.lidToPhoneMap.set(lidUser, clean);
              count++;
            }
          } catch {}
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  // Определение реального номера телефона по JID (поддержка @s.whatsapp.net и Multi-Device @lid)
  resolvePhone(jid: string): string | null {
    if (!jid) return null;
    if (jid.includes('@broadcast') || jid.includes('@g.us')) return null;

    // 1. Прямой номер: 77001234567@s.whatsapp.net или 77001234567:0@s.whatsapp.net
    if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
      const raw = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
      return normalizePhone(raw);
    }

    // 2. Multi-Device LID: 100055742701651@lid
    if (jid.endsWith('@lid')) {
      const lidUser = jid.split('@')[0].split(':')[0];
      // Проверяем кэш в памяти
      const cached = this.lidToPhoneMap.get(lidUser);
      if (cached) return normalizePhone(cached);

      // Проверяем файл на диске
      const reversePath = path.join(this.authDir, `lid-mapping-${lidUser}_reverse.json`);
      try {
        if (fsSync.existsSync(reversePath)) {
          const raw = fsSync.readFileSync(reversePath, 'utf8');
          const phone = JSON.parse(raw);
          if (phone) {
            const clean = String(phone).replace(/\D/g, '');
            this.lidToPhoneMap.set(lidUser, clean);
            return normalizePhone(clean);
          }
        }
      } catch {}
    }

    return null;
  }

  // Универсальное извлечение текста из любого типа сообщения (ephemeral, viewOnce, audio, doc)
  extractMessageText(msg: any): string {
    if (!msg) return '';
    if (msg.ephemeralMessage?.message) return this.extractMessageText(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage?.message) return this.extractMessageText(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2?.message) return this.extractMessageText(msg.viewOnceMessageV2.message);
    if (msg.documentWithCaptionMessage?.message) return this.extractMessageText(msg.documentWithCaptionMessage.message);
    if (msg.editedMessage?.message) return this.extractMessageText(msg.editedMessage.message);

    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
    if (msg.imageMessage?.caption) return `[Изображение] ${msg.imageMessage.caption}`;
    if (msg.videoMessage?.caption) return `[Видео] ${msg.videoMessage.caption}`;
    if (msg.documentMessage?.fileName || msg.documentMessage?.title) {
      return `[Документ: ${msg.documentMessage.fileName || msg.documentMessage.title}]`;
    }
    if (msg.audioMessage) return '[Голосовое сообщение]';
    if (msg.imageMessage) return '[Изображение]';
    if (msg.videoMessage) return '[Видео]';
    if (msg.stickerMessage) return '[Стикер]';
    if (msg.contactMessage?.displayName) return `[Контакт: ${msg.contactMessage.displayName}]`;
    if (msg.locationMessage) return '[Геолокация]';

    return '';
  }

  getStatus() {
    return {
      status: this.status,
      qr: this.qrDataUrl,
      user: this.connectedUser,
      error: this.lastError,
      syncStats: this.syncStats,
      settings: this.settings,
    };
  }

  getFeed() {
    return {
      feed: this.liveFeed,
      syncStats: this.syncStats,
      settings: this.settings,
    };
  }

  updateSettings(newSettings: Partial<typeof this.settings>) {
    this.settings = { ...this.settings, ...newSettings };
    return this.settings;
  }

  async autoStartIfSaved(): Promise<void> {
    try {
      const credsPath = path.join(this.authDir, 'creds.json');
      await fs.access(credsPath);
      console.log('Found saved WhatsApp credentials, auto-connecting...');
      this.loadLidMappings();
      await this.start();
    } catch {
      // Файл авторизации не найден — ожидает ручного подключения через QR
    }
  }

  async start(): Promise<void> {
    if (this.isStarting) {
      return;
    }

    this.isStarting = true;
    clearTimeout(this.reconnectTimer);
    this.isExplicitLogout = false;
    this.status = 'CONNECTING';
    this.lastError = null;

    try {
      if (this.sock) {
        try {
          this.sock.end(undefined);
        } catch {}
        this.sock = null;
      }

      await fs.mkdir(this.authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['TANBOX CRM', 'Chrome', '1.0.0'],
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 25000,
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true,
      });

      this.sock = sock;

      sock.ev.on('creds.update', () => {
        saveCreds();
        this.loadLidMappings();
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
            this.status = 'SCAN_QR';
            console.log('[WhatsApp] QR-код готов для сканирования');
          } catch (e: any) {
            console.error('[WhatsApp] Не удалось сформировать QR-код:', e);
            this.lastError = 'Не удалось сформировать QR-код';
          }
        }

        if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrDataUrl = null;
          this.lastError = null;
          clearTimeout(this.reconnectTimer);
          const userPhone = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : undefined;
          this.connectedUser = {
            phone: userPhone,
            name: sock.user?.name || undefined,
          };
          console.log(`[WhatsApp] Успешное подключение к аккаунту: +${userPhone}`);
          const count = this.loadLidMappings();
          console.log(`[WhatsApp] Загружено сопоставлений контактов Multi-Device: ${count}`);
        }

        if (connection === 'close') {
          this.qrDataUrl = null;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || this.isExplicitLogout;

          if (isLoggedOut) {
            this.status = 'DISCONNECTED';
            this.connectedUser = null;
            await this.clearAuthData();
            console.log('[WhatsApp] Сессия закрыта (выход выполнен).');
          } else {
            this.status = 'CONNECTING';
            this.connectedUser = null;
            const isRestart = statusCode === DisconnectReason.restartRequired || statusCode === 515;
            const delay = isRestart ? 300 : 3000;
            console.log(`[WhatsApp] Соединение прервано (код ${statusCode}), переподключение через ${delay}мс...`);
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
              void this.start();
            }, delay);
          }
        }
      });

      // Синхронизация истории от WhatsApp Web Multi-Device
      sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, syncType }) => {
        console.log(`[WhatsApp] Пакет истории от серверов: ${chats?.length || 0} чатов, ${contacts?.length || 0} контактов, ${messages?.length || 0} сообщений (syncType: ${syncType})`);
        this.loadLidMappings();
        if (messages && messages.length > 0) {
          this.syncStats.isSyncing = true;
          try {
            const result = await this.importHistoricalMessages(messages);
            this.syncStats.importedMessages += result.importedMessages;
            this.syncStats.lastSyncAt = new Date().toISOString();
            console.log(`[WhatsApp] Успешно импортировано сообщений из истории: +${result.importedMessages}`);
          } catch (e: any) {
            console.warn('[WhatsApp] Ошибка обработки истории сообщений:', e?.message || e);
          } finally {
            this.syncStats.isSyncing = false;
          }
        }
      });

      // Перехват входящих и исходящих сообщений в реальном времени
      sock.ev.on('messages.upsert', async ({ messages }) => {
        this.loadLidMappings();
        for (const m of messages) {
          if (!m.message) continue;
          const remoteJid = m.key.remoteJid;
          if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('@g.us')) continue;

          // Фильтрация повторных доставок одного и того же пакета Baileys
          const waMsgId = m.key.id;
          if (waMsgId) {
            if (this.processedWaMessageIds.has(waMsgId)) continue;
            this.processedWaMessageIds.add(waMsgId);
            if (this.processedWaMessageIds.size > 10000) {
              const it = this.processedWaMessageIds.values();
              for (let i = 0; i < 5000; i++) {
                const nextVal = it.next().value;
                if (nextVal) this.processedWaMessageIds.delete(nextVal);
              }
            }
          }

          const fromMe = Boolean(m.key.fromMe);
          const sender: 'CLIENT' | 'MANAGER' = fromMe ? 'MANAGER' : 'CLIENT';
          const senderName = m.pushName || (fromMe ? 'Менеджер Tanbox' : undefined);

          const content = this.extractMessageText(m.message).trim();
          if (!content) continue;

          // Резолвим телефон контакта (поддерживает и прямые номера, и LID)
          const resolvedPhone = this.resolvePhone(remoteJid);
          if (!resolvedPhone) {
            console.warn(`[WhatsApp] Не удалось сопоставить JID с телефоном: ${remoteJid}`);
            continue;
          }

          const timestamp = m.messageTimestamp
            ? new Date(Number(m.messageTimestamp) * 1000)
            : new Date();

          console.log(`[WhatsApp] Перехвачено сообщение от +${resolvedPhone} (${sender}): "${content.slice(0, 80)}"`);

          // Добавление в живую ленту для страницы
          this.liveFeed.unshift({
            id: m.key.id || Math.random().toString(),
            phone: resolvedPhone,
            sender,
            senderName,
            content,
            timestamp: timestamp.toISOString(),
          });
          if (this.liveFeed.length > 50) this.liveFeed.pop();

          // Постановка в очередь для пакетной записи в CRM
          this.queueMessage(
            resolvedPhone,
            {
              id: waMsgId || undefined,
              sender,
              senderName,
              content,
              timestamp,
            },
            m.pushName || undefined
          );
        }
      });
    } catch (err: any) {
      this.status = 'DISCONNECTED';
      this.lastError = err?.message || 'Ошибка запуска WhatsApp';
      console.error('[WhatsApp] Ошибка запуска сокета:', err);
    } finally {
      this.isStarting = false;
    }
  }

  // Синхронизация: актуализация маппингов LID и контактов
  async syncExistingChatsFromStore(): Promise<{ importedChats: number; importedMessages: number }> {
    const count = this.loadLidMappings();
    console.log(`[WhatsApp] Актуализировано ${count} контактов Multi-Device в памяти. Пустые карточки без сообщений не создаются.`);
    return { importedChats: 0, importedMessages: 0 };
  }

  // Импорт сырых исторических сообщений
  async importHistoricalMessages(rawMessages: any[]): Promise<{ importedChats: number; importedMessages: number }> {
    if (!rawMessages || !rawMessages.length) return { importedChats: 0, importedMessages: 0 };

    const byPhone = new Map<string, { sender: 'CLIENT' | 'MANAGER'; content: string; timestamp: Date; senderName?: string }[]>();

    for (const m of rawMessages) {
      if (!m.message) continue;
      const remoteJid = m.key?.remoteJid;
      if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('@g.us')) continue;

      const content = this.extractMessageText(m.message).trim();
      if (!content) continue;

      const phone = this.resolvePhone(remoteJid);
      if (!phone) continue;

      const fromMe = Boolean(m.key?.fromMe);
      const sender: 'CLIENT' | 'MANAGER' = fromMe ? 'MANAGER' : 'CLIENT';
      const senderName = m.pushName || (fromMe ? 'Менеджер Tanbox' : undefined);
      const timestamp = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : new Date();

      const existing = byPhone.get(phone) || [];
      existing.push({ sender, content, timestamp, senderName });
      byPhone.set(phone, existing);
    }

    let importedChats = 0;
    let importedMessages = 0;

    for (const [phone, msgs] of byPhone.entries()) {
      msgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const recent = msgs.slice(-30);

      try {
        await prisma.$transaction(async (tx) => {
          let client = await tx.client.findFirst({
            where: { phone },
            include: { conversations: { orderBy: { createdAt: 'desc' }, take: 1 } },
          });

          const latestTime = recent[recent.length - 1].timestamp;

          if (!client) {
            const clientName = recent[0].senderName || `Клиент WhatsApp +${phone}`;
            client = await tx.client.create({
              data: {
                name: clientName,
                phone,
                status: 'LEAD',
                category: 'OTHER',
                aiSummary: 'Импортирован из истории диалогов WhatsApp',
                lastContactAt: latestTime,
              },
              include: { conversations: true },
            });
            await tx.deal.create({
              data: { clientId: client.id, title: `Заказ: ${client.name}`, stage: 'NEW' },
            });
            importedChats++;
          }

          let chunk = client.conversations[0];
          if (!chunk) {
            chunk = await tx.conversationChunk.create({
              data: {
                clientId: client.id,
                channel: 'WHATSAPP',
                source: 'WHATSAPP_HISTORY',
                summary: 'История диалога WhatsApp',
              },
            });
          }

          let position = 0;
          for (const msg of recent) {
            const timeWindowStart = new Date(msg.timestamp.getTime() - 2000);
            const timeWindowEnd = new Date(msg.timestamp.getTime() + 2000);

            const exists = await tx.message.findFirst({
              where: {
                chunkId: chunk.id,
                sender: msg.sender,
                content: msg.content,
                timestamp: {
                  gte: timeWindowStart,
                  lte: timeWindowEnd,
                },
              },
            });
            if (!exists) {
              await tx.message.create({
                data: {
                  chunkId: chunk.id,
                  sender: msg.sender,
                  senderName: msg.senderName || null,
                  content: msg.content,
                  timestamp: msg.timestamp,
                  position: position++,
                  originalTime: msg.timestamp.toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                },
              });
              importedMessages++;
            }
          }
        });
      } catch (err) {
        console.warn(`[WhatsApp] Ошибка сохранения истории для +${phone}:`, err);
      }
    }

    return { importedChats, importedMessages };
  }

  // Ручной или автоматический запуск синхронизации
  async triggerHistorySync(): Promise<{ ok: boolean; notice: string; stats: WhatsAppSyncStats }> {
    if (!this.sock || this.status !== 'CONNECTED') {
      return {
        ok: false,
        notice: 'WhatsApp не подключен. Сначала привяжите номер через QR-код.',
        stats: this.syncStats,
      };
    }

    console.log('[WhatsApp] Запрос синхронизации истории сообщений...');
    this.syncStats.isSyncing = true;
    try {
      this.loadLidMappings();

      // Запрашиваем историю сообщений у серверов WhatsApp
      await (this.sock as any)
        .resyncAppState?.(['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'])
        .catch(() => {});

      const notice = 'Запрос на синхронизацию истории отправлен в WhatsApp. Карточки клиентов создаются строго при получении переписки.';
      console.log(`[WhatsApp] ${notice}`);

      return {
        ok: true,
        notice,
        stats: this.syncStats,
      };
    } catch (e: any) {
      console.error('[WhatsApp] Ошибка при синхронизации истории:', e?.message || e);
      return {
        ok: false,
        notice: 'Ошибка синхронизации: ' + (e?.message || 'неизвестная ошибка'),
        stats: this.syncStats,
      };
    } finally {
      this.syncStats.isSyncing = false;
    }
  }

  private queueMessage(phone: string, msg: BufferedMessage, pushName?: string) {
    const existing = this.buffers.get(phone);
    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(msg);
      if (pushName && !existing.pushName) existing.pushName = pushName;
      existing.timer = setTimeout(() => {
        void this.flushMessageBuffer(phone);
      }, 2000);
    } else {
      const timer = setTimeout(() => {
        void this.flushMessageBuffer(phone);
      }, 2000);
      this.buffers.set(phone, {
        timer,
        messages: [msg],
        pushName,
      });
    }
  }

  private async flushMessageBuffer(phone: string) {
    const buffer = this.buffers.get(phone);
    this.buffers.delete(phone);
    if (!buffer || !buffer.messages.length) return;

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return;

    const messages = buffer.messages;
    const pushName = buffer.pushName;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Поиск или создание клиента
        let client = await tx.client.findFirst({
          where: { phone: normalizedPhone },
          include: {
            conversations: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { messages: { orderBy: { position: 'desc' }, take: 30 } },
            },
          },
        });

        const latestTimestamp = messages[messages.length - 1].timestamp;

        if (!client) {
          if (!this.settings.autoCreateLeads) return;
          const clientName = pushName || `Клиент WhatsApp +${normalizedPhone}`;
          client = await tx.client.create({
            data: {
              name: clientName,
              phone: normalizedPhone,
              status: 'LEAD',
              category: 'OTHER',
              aiSummary: `Диалог WhatsApp`,
              lastContactAt: latestTimestamp,
            },
            include: {
              conversations: {
                take: 1,
                include: { messages: true },
              },
            },
          });

          // Создание первичной сделки
          await tx.deal.create({
            data: {
              clientId: client.id,
              title: `Заказ: ${client.name}`,
              stage: 'NEW',
            },
          });
          console.log(`[CRM] Создан новый клиент: +${normalizedPhone} («${clientName}») и сделка на этапе «Новые лиды»`);
        } else {
          await tx.client.update({
            where: { id: client.id },
            data: { lastContactAt: latestTimestamp },
          });
        }

        // 2. Определение активного диалогового чанка (за последние 24 часа)
        let activeChunk = client.conversations[0];
        const isRecent =
          activeChunk &&
          Date.now() - new Date(activeChunk.createdAt).getTime() < 24 * 60 * 60 * 1000;

        if (!isRecent) {
          activeChunk = await tx.conversationChunk.create({
            data: {
              clientId: client.id,
              channel: 'WHATSAPP',
              source: 'WHATSAPP_LIVE',
              summary: 'Диалог WhatsApp',
            },
            include: { messages: { orderBy: { position: 'desc' }, take: 1 } },
          });
        }

        // 3. Сохранение сообщений с дедупликацией
        let currentPos = (activeChunk.messages?.[0]?.position ?? -1) + 1;

        for (const msg of messages) {
          // Защита от дублей: считаем дублем только если то же самое сообщение
          // с тем же текстом и отправителем пришло в пределах 2 секунд (сетевой повтор пакета Baileys).
          // Если клиент написал то же самое слово («Да», «Привет», «Ок») позже — оно обязательно фиксируется!
          const timeWindowStart = new Date(msg.timestamp.getTime() - 2000);
          const timeWindowEnd = new Date(msg.timestamp.getTime() + 2000);

          const existing = await tx.message.findFirst({
            where: {
              chunkId: activeChunk.id,
              sender: msg.sender,
              content: msg.content,
              timestamp: {
                gte: timeWindowStart,
                lte: timeWindowEnd,
              },
            },
          });

          if (!existing) {
            await tx.message.create({
              data: {
                chunkId: activeChunk.id,
                sender: msg.sender,
                senderName: msg.senderName || null,
                content: msg.content,
                timestamp: msg.timestamp,
                position: currentPos++,
                originalTime: msg.timestamp.toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              },
            });
            console.log(`[CRM] Сообщение сохранено в карточку клиента +${normalizedPhone}: "${msg.content.slice(0, 50)}"`);
          }
        }
      });
    } catch (error) {
      console.error(`[WhatsApp] Ошибка сохранения сообщений для +${normalizedPhone}:`, error);
    }
  }

  async logout(): Promise<void> {
    this.isExplicitLogout = true;
    clearTimeout(this.reconnectTimer);
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {}
      this.sock = null;
    }
    this.status = 'DISCONNECTED';
    this.connectedUser = null;
    await this.clearAuthData();
    console.log('[WhatsApp] Аккаунт отключен, сессия очищена.');
  }

  async restart(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }
    this.status = 'CONNECTING';
    await this.start();
  }

  async stop(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }
    this.status = 'DISCONNECTED';
  }

  private async clearAuthData(): Promise<void> {
    try {
      await fs.rm(this.authDir, { recursive: true, force: true });
      this.lidToPhoneMap.clear();
    } catch (e) {
      console.error('[WhatsApp] Ошибка очистки папки auth:', e);
    }
  }
}

export const whatsappService = new WhatsAppService();

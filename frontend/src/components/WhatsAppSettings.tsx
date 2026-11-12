import React, { useEffect, useState } from 'react';
import {
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Smartphone,
  ShieldCheck,
  DownloadCloud,
  Settings2,
  Radio,
  ExternalLink,
  UserCheck,
} from 'lucide-react';
import { api } from '../api';
import { formatPhoneDigits } from '../utils/labels';

export const WhatsAppSettings: React.FC = () => {
  const [status, setStatus] = useState<
    'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED'
  >('DISCONNECTED');
  const [qr, setQr] = useState<string | null>(null);
  const [user, setUser] = useState<{ phone?: string; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const [syncStats, setSyncStats] = useState({
    isSyncing: false,
    lastSyncAt: null as string | null,
    importedChats: 0,
    importedMessages: 0,
  });

  const [settings, setSettings] = useState({
    autoCreateLeads: true,
  });

  const [liveFeed, setLiveFeed] = useState<any[]>([]);

  const fetchStatusAndFeed = async (signal?: AbortSignal) => {
    try {
      const [statusRes, feedRes] = await Promise.allSettled([
        api.getWhatsAppStatus(signal),
        api.getWhatsAppFeed(signal),
      ]);

      if (statusRes.status === 'fulfilled') {
        const data = statusRes.value;
        setStatus(data.status);
        setQr(data.qr);
        setUser(data.user);
        if (data.syncStats) setSyncStats(data.syncStats);
        if (data.settings) {
          setSettings({
            autoCreateLeads: Boolean(data.settings.autoCreateLeads),
          });
        }
        setError(data.error);
      }

      if (feedRes.status === 'fulfilled') {
        setLiveFeed(feedRes.value.feed || []);
        if (feedRes.value.syncStats) setSyncStats(feedRes.value.syncStats);
        if (feedRes.value.settings) {
          setSettings({
            autoCreateLeads: Boolean(feedRes.value.settings.autoCreateLeads),
          });
        }
      }
    } catch (e: any) {
      if (signal?.aborted) return;
      setError(e.message || 'Не удалось обновить статус');
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchStatusAndFeed(controller.signal);

    const timer = setInterval(() => {
      void fetchStatusAndFeed();
    }, 2500);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.connectWhatsApp();
      await fetchStatusAndFeed();
    } catch (e: any) {
      setError(e.message || 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.restartWhatsApp();
      await fetchStatusAndFeed();
    } catch (e: any) {
      setError(e.message || 'Ошибка перезапуска');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (
      !window.confirm(
        'Отключить текущую сессию WhatsApp? Для повторной работы потребуется отсканировать QR-код заново.'
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.logoutWhatsApp();
      await fetchStatusAndFeed();
    } catch (e: any) {
      setError(e.message || 'Ошибка отключения');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncHistory = async () => {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const res = await api.syncWhatsAppHistory();
      setSyncNotice(res.notice);
      if (res.stats) setSyncStats(res.stats);
    } catch (e: any) {
      setError(e.message || 'Ошибка синхронизации истории');
    } finally {
      setSyncing(false);
    }
  };

  const toggleAutoCreateLeads = async () => {
    const nextVal = !settings.autoCreateLeads;
    setSettings({ autoCreateLeads: nextVal });
    try {
      await api.updateWhatsAppSettings({ autoCreateLeads: nextVal, autoRunAi: false });
    } catch {
      setSettings({ autoCreateLeads: !nextVal });
    }
  };

  return (
    <div className="w-full h-full flex flex-col space-y-4">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">
                Интеграция WhatsApp
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                  status === 'CONNECTED'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : status === 'SCAN_QR' || status === 'CONNECTING'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    status === 'CONNECTED'
                      ? 'bg-emerald-500 animate-pulse'
                      : status === 'SCAN_QR' || status === 'CONNECTING'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-slate-400'
                  }`}
                />
                <span>
                  {status === 'CONNECTED' &&
                    `В сети / Номер: ${user?.phone ? '+' + user.phone : 'Подключен'}`}
                  {status === 'SCAN_QR' && 'Ожидание сканирования QR'}
                  {status === 'CONNECTING' && 'Подключение к серверам WhatsApp...'}
                  {status === 'DISCONNECTED' && 'Шлюз отключен'}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Собственный автономный шлюз Multi-Device: входящие и исходящие сообщения сохраняются в карточки клиентов CRM
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {status === 'CONNECTED' && (
            <button
              type="button"
              disabled={loading || syncing}
              onClick={handleSyncHistory}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <DownloadCloud className={`w-3.5 h-3.5 ${syncing ? 'animate-bounce' : ''}`} />
              <span>{syncing ? 'Запрос истории…' : 'Синхронизировать чаты'}</span>
            </button>
          )}

          {status === 'CONNECTED' ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Отключить</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={handleConnect}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Подключить WhatsApp</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs underline font-semibold"
          >
            Скрыть
          </button>
        </div>
      )}

      {syncNotice && (
        <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{syncNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncNotice(null)}
            className="text-xs underline font-semibold"
          >
            Скрыть
          </button>
        </div>
      )}

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 flex-1 items-start">
        {/* Left Column (Settings & Sync) */}
        <div className="xl:col-span-7 space-y-4">
          {/* Card 1: Connection & Device Info */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-[#0082FB]" />
                <span>Устройство и статус авторизации</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                Сохранено в <code>data/whatsapp-auth</code>
              </span>
            </div>

            {status === 'CONNECTED' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                      WA
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        {user?.name || 'Рабочий аккаунт WhatsApp'}
                      </p>
                      <p className="text-xs text-slate-600 font-semibold tabular-nums mt-0.5">
                        {user?.phone ? `+${user.phone}` : 'Номер подключен'}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-600 text-white font-semibold">
                    В сети
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                    <span className="text-[11px] text-slate-500 block">Тип подключения:</span>
                    <strong className="text-slate-800">WhatsApp Multi-Device</strong>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                    <span className="text-[11px] text-slate-500 block">Шифрование:</span>
                    <strong className="text-emerald-700">Сквозное (E2EE)</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleRestart}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Переподключить сессию</span>
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleLogout}
                    className="text-xs font-semibold text-red-700 hover:underline"
                  >
                    Сменить номер
                  </button>
                </div>
              </div>
            ) : status === 'SCAN_QR' && qr ? (
              <div className="text-center py-2 space-y-4">
                <div className="inline-block bg-white p-3.5 rounded-2xl border-2 border-slate-200 shadow-xl">
                  <img
                    src={qr}
                    alt="WhatsApp QR Code"
                    className="w-64 h-64 object-contain rounded-xl mx-auto"
                  />
                </div>

                <div className="text-left bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs text-slate-700">
                  <strong className="text-slate-900 block">
                    Как привязать телефон:
                  </strong>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 leading-relaxed">
                    <li>Откройте WhatsApp на телефоне.</li>
                    <li>
                      Перейдите в <strong>Связанные устройства</strong> (в меню или настройках).
                    </li>
                    <li>
                      Нажмите <strong>«Привязка устройства»</strong>.
                    </li>
                    <li>Наведите камеру на QR-код на экране.</li>
                  </ol>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleRestart}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Обновить QR-код</span>
                </button>
              </div>
            ) : status === 'CONNECTING' ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-[#0082FB] animate-spin mx-auto" />
                <p className="text-xs font-semibold text-slate-800">
                  Подключение к WhatsApp...
                </p>
                <p className="text-[11px] text-slate-500">
                  Устанавливаем защищённое WebSocket-соединение.
                </p>
              </div>
            ) : (
              <div className="py-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-500">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-slate-900">
                    Номер не привязан
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Нажмите кнопку ниже, чтобы сгенерировать QR-код и привязать рабочий номер к CRM.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleConnect}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Сгенерировать QR-код для входа</span>
                </button>
              </div>
            )}
          </div>

          {/* Card 2: History Sync */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <DownloadCloud className="w-4 h-4 text-[#0082FB]" />
                <span>Синхронизация существующих диалогов</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                Синхронизация истории
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Диалогов импортировано:</span>
                <span className="text-base font-bold text-slate-900 tabular-nums">
                  {syncStats.importedChats.toLocaleString('ru-RU')}
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Сообщений в базе:</span>
                <span className="text-base font-bold text-[#0082FB] tabular-nums">
                  {syncStats.importedMessages.toLocaleString('ru-RU')}
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Последняя синхронизация:</span>
                <span className="text-xs font-semibold text-slate-700 tabular-nums block mt-1">
                  {syncStats.lastSyncAt
                    ? new Date(syncStats.lastSyncAt).toLocaleString('ru-RU')
                    : 'Ещё не запускалась'}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/60 border border-blue-200/70 p-3 rounded-lg">
              Карточки клиентов и сделки создаются автоматически только тогда, когда есть реальная переписка (входящие или исходящие сообщения). Пустые контакты без сообщений не создаются и не засоряют воронку.
            </p>

            <div className="pt-1 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={status !== 'CONNECTED' || syncing}
                onClick={handleSyncHistory}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
              >
                <DownloadCloud className={`w-4 h-4 ${syncing ? 'animate-bounce' : ''}`} />
                <span>{syncing ? 'Запрос истории у WhatsApp…' : 'Загрузить существующие диалоги с телефона'}</span>
              </button>

              {status !== 'CONNECTED' && (
                <span className="text-xs text-amber-700 font-medium">
                  Сначала подключите WhatsApp выше
                </span>
              )}
            </div>
          </div>

          {/* Card 3: CRM Automation Settings (No AI) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Settings2 className="w-4 h-4 text-[#0082FB]" />
                <span>Автоматизация CRM</span>
              </h3>
            </div>

            <div>
              <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-900 block flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-[#0082FB]" />
                    <span>Автоматически создавать карточку клиента и сделку</span>
                  </span>
                  <span className="text-[11px] text-slate-500 leading-relaxed block">
                    Если входящее сообщение поступило с нового номера телефона, CRM сразу создаст лид и новую сделку на этапе «Новые лиды».
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoCreateLeads}
                  onChange={toggleAutoCreateLeads}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0082FB] focus:ring-[#0082FB]"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Live Message Feed */}
        <div className="xl:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500">
                  Живой поток сообщений
                </h3>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold tabular-nums">
                {liveFeed.length} сообщ.
              </span>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Поток перехваченных сообщений обновляется в реальном времени каждые 2.5 секунды.
            </p>

            {liveFeed.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200/80">
                Пока нет пойманных сообщений. Отправьте тестовое сообщение в WhatsApp.
              </div>
            ) : (
              <div className="max-h-[640px] overflow-y-auto space-y-2.5 pr-1">
                {liveFeed.map((msg) => {
                  const isManager = msg.sender === 'MANAGER';
                  const waDigits = formatPhoneDigits(msg.phone);

                  return (
                    <div
                      key={msg.id}
                      className={`p-3.5 rounded-xl border text-xs space-y-1.5 transition-colors ${
                        isManager
                          ? 'bg-blue-50/50 border-blue-200/80'
                          : 'bg-white border-slate-200 shadow-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isManager
                                ? 'bg-blue-600 text-white'
                                : 'bg-emerald-600 text-white'
                            }`}
                          >
                            {isManager ? 'Менеджер' : 'Клиент'}
                          </span>
                          <span className="font-semibold text-slate-900 truncate">
                            {msg.senderName || `+${msg.phone}`}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                          {new Date(msg.timestamp).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>

                      <p className="text-slate-800 whitespace-pre-wrap leading-relaxed text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        {msg.content}
                      </p>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          Номер: +{msg.phone}
                        </span>
                        {waDigits && (
                          <a
                            href={`https://wa.me/${waDigits}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:underline"
                          >
                            <span>Открыть в WhatsApp</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

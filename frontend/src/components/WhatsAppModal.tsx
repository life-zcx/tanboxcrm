import React, { useEffect, useState } from 'react';
import {
  X,
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Smartphone,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';

interface WhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: (status: string) => void;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  isOpen,
  onClose,
  onStatusChange,
}) => {
  const [status, setStatus] = useState<
    'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED'
  >('DISCONNECTED');
  const [qr, setQr] = useState<string | null>(null);
  const [user, setUser] = useState<{ phone?: string; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchStatus = async (signal?: AbortSignal) => {
    try {
      const data = await api.getWhatsAppStatus(signal);
      setStatus(data.status);
      setQr(data.qr);
      setUser(data.user);
      setError(data.error);
      onStatusChange?.(data.status);
    } catch (e: any) {
      if (signal?.aborted) return;
      setError(e.message || 'Не удалось получить статус WhatsApp');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    void fetchStatus(controller.signal);

    const timer = setInterval(() => {
      void fetchStatus();
    }, 2500);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [isOpen]);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    setActionNotice('Запуск подключения к серверам WhatsApp...');
    try {
      await api.connectWhatsApp();
      await fetchStatus();
    } catch (e: any) {
      setError(e.message || 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    setLoading(true);
    setError(null);
    setActionNotice('Обновление QR-кода...');
    try {
      await api.restartWhatsApp();
      await fetchStatus();
    } catch (e: any) {
      setError(e.message || 'Ошибка перезапуска');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Отключить текущую сессию WhatsApp? Для повторной работы потребуется отсканировать QR-код заново.')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.logoutWhatsApp();
      await fetchStatus();
      setActionNotice('Сессия завершена.');
    } catch (e: any) {
      setError(e.message || 'Ошибка отключения');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-modal-title"
        className="bg-white border border-slate-200 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 id="whatsapp-modal-title" className="font-bold text-sm text-slate-900">
                Подключение WhatsApp
              </h3>
              <p className="text-[11px] text-slate-500">
                Собственный автономный парсер сообщений в реальном времени
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                status === 'CONNECTED'
                  ? 'bg-emerald-500 animate-pulse'
                  : status === 'CONNECTING' || status === 'SCAN_QR'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-slate-400'
              }`}
            />
            <span className="font-semibold text-slate-800">
              {status === 'CONNECTED' && 'Подключен и слушает переписки'}
              {status === 'SCAN_QR' && 'Ожидание сканирования QR-кода'}
              {status === 'CONNECTING' && 'Подключение к WhatsApp...'}
              {status === 'DISCONNECTED' && 'Не подключен'}
            </span>
          </div>

          {status === 'CONNECTED' && user?.phone && (
            <span className="text-slate-600 font-medium tabular-nums bg-white px-2 py-0.5 rounded border border-slate-200">
              +{user.phone} {user.name ? `(${user.name})` : ''}
            </span>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {actionNotice && !error && (
          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs">
            {actionNotice}
          </div>
        )}

        {/* Content based on status */}
        {status === 'CONNECTED' ? (
          <div className="text-center py-6 space-y-3 bg-emerald-50/50 border border-emerald-100 rounded-xl p-5">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <h4 className="font-bold text-sm text-slate-900">
              Связь установлена
            </h4>
            <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
              Все новые входящие сообщения от клиентов и ответы менеджера автоматически попадают в CRM,
              привязываются к клиентам и анализируются ИИ. Скриншоты больше не нужны.
            </p>
            <div className="pt-2">
              <button
                type="button"
                disabled={loading}
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Отключить этот номер / выйти</span>
              </button>
            </div>
          </div>
        ) : status === 'SCAN_QR' && qr ? (
          <div className="space-y-4 text-center">
            <div className="relative inline-block bg-white p-3 rounded-2xl border-2 border-slate-200 shadow-lg">
              <img
                src={qr}
                alt="WhatsApp QR Code"
                className="w-64 h-64 object-contain rounded-xl mx-auto"
              />
            </div>

            <div className="text-left bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs text-slate-700">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-[#0082FB]" />
                <span>Инструкция для подключения:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed text-slate-600">
                <li>Откройте WhatsApp на рабочем смартфоне.</li>
                <li>Нажмите <strong>Меню</strong> (три точки) или <strong>Настройки</strong> → <strong>Связанные устройства</strong>.</li>
                <li>Нажмите <strong>«Привязка устройства»</strong>.</li>
                <li>Наведите камеру на этот QR-код.</li>
              </ol>
            </div>

            <div className="flex items-center justify-center gap-2">
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
          </div>
        ) : status === 'CONNECTING' ? (
          <div className="text-center py-12 space-y-3">
            <RefreshCw className="w-8 h-8 text-[#0082FB] animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-800">
              Подключение к серверам WhatsApp...
            </p>
            <p className="text-[11px] text-slate-500">
              Формируем защищённую сессию и готовим QR-код.
            </p>
          </div>
        ) : (
          <div className="text-center py-8 space-y-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-500">
              <MessageCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-slate-900">
                WhatsApp не подключен
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
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
              <span>Сгенерировать QR-код для привязки</span>
            </button>
          </div>
        )}

        {/* Security badge footer */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Прямое сквозное шифрование (Multi-Device)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900 font-semibold"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};


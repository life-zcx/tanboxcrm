import React, { useEffect, useState, useRef } from 'react';
import { Send, ShieldCheck, Lock, ExternalLink } from 'lucide-react';
import { api, AdminUser } from '../api';

export const LoginPage: React.FC<{ onLoginSuccess: (user: AdminUser) => void }> = ({
  onLoginSuccess,
}) => {
  const [code, setCode] = useState('');
  const [botUrl, setBotUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramLoginEnabled, setTelegramLoginEnabled] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    fetch('/api/auth/telegram/config', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then(data => setTelegramLoginEnabled(Boolean(data?.enabled)))
      .catch(() => {});
    const result = new URLSearchParams(window.location.search).get('telegram');
    if (result === 'pending') setError('Заявка отправлена владельцу CRM. После одобрения нажмите «Войти через Telegram» ещё раз.');
    else if (result === 'denied') setError('Доступ отклонён или отозван. Повторный запрос доступен через 24 часа.');
    else if (result === 'expired') setError('Время входа истекло. Попробуйте снова.');
    else if (result === 'failed') setError('Telegram не подтвердил вход. Попробуйте снова.');
    else if (result === 'unavailable') setError('Вход через Telegram временно недоступен.');
  }, []);

  const request = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await api.requestCode();
      setBotUrl(r.botUrl);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запросить вход');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const submit = async (value: string) => {
    if (inFlight.current || !/^\d{6}$/.test(value)) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await api.verifyCode(value);
      onLoginSuccess(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить код');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-7 shadow-sm space-y-6">
        <div className="text-center space-y-1.5 border-b border-slate-100 pb-5">
          <img src="/tanbox-dark.svg" alt="Tanbox" className="h-7 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">Вход в систему управления</h1>
          <p className="text-xs text-slate-500">Одноразовый код авторизации через Telegram</p>
        </div>

        {telegramLoginEnabled && (
          <button type="button" onClick={() => window.location.assign('/api/auth/telegram/start')}
            className="w-full bg-[#0082FB] hover:bg-[#0070D8] text-white px-4 py-3 rounded-lg font-semibold transition-colors">
            Войти через Telegram
          </button>
        )}

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3 text-xs text-slate-700 leading-relaxed">
          <p>
            Получите ссылку входа и откройте бота. Если у вас ещё нет доступа, бот отправит заявку владельцу.
            После одобрения запросите новую ссылку и войдите по одноразовому коду.
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={request}
            className="w-full bg-[#0082FB] hover:bg-[#0070D8] text-white px-4 py-2.5 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>{botUrl ? 'Получить новую ссылку' : 'Получить код в Telegram'}</span>
          </button>
          {botUrl && (
            <a
              href={botUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-[#0082FB] font-semibold hover:underline pt-1"
            >
              <span>Открыть Telegram-бота</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {botUrl && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(code);
            }}
            className="space-y-3.5"
          >
            <label
              className="block text-xs font-semibold text-slate-700 text-center"
              htmlFor="login-code"
            >
              Введите 6-значный код из Telegram
            </label>
            <input
              id="login-code"
              aria-label="Код из Telegram"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={loading}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(value);
                setError(null);
                if (value.length === 6) void submit(value);
              }}
              className="w-full border border-slate-300 focus:border-[#0082FB] focus:outline-none rounded-lg py-3 px-4 text-2xl font-mono font-bold text-center tracking-[0.35em] text-slate-900 bg-slate-50 focus:bg-white tabular-nums"
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{loading ? 'Проверка кода…' : 'Войти в TANBOX CRM'}</span>
            </button>
          </form>
        )}

        {error && (
          <p
            role="alert"
            className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg p-3"
          >
            {error}
          </p>
        )}

        <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 pt-1">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
          <span>Код действует 5 минут</span>
        </p>
      </div>
    </div>
  );
};

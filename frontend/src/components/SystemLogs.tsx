import React, { useEffect, useState, useRef } from 'react';
import {
  Terminal,
  Search,
  RefreshCw,
  Copy,
  Download,
  Trash2,
  Server,
  Layout,
  MessageCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { api } from '../api';
import { frontendLogger } from '../utils/frontend-logger';

interface LogEntry {
  id: string;
  timestamp: string;
  timeFormatted: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'WHATSAPP';
  category: 'SYSTEM' | 'BACKEND' | 'FRONTEND' | 'WHATSAPP' | 'AUTH' | 'CRM';
  message: string;
  details?: any;
}

export const SystemLogs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async (signal?: AbortSignal) => {
    try {
      const res = await api.getLogs({ limit: 800 }, signal);
      if (res && Array.isArray(res.logs)) {
        setLogs(res.logs);
      }
    } catch {}
  };

  useEffect(() => {
    frontendLogger.info('[Навигация] Открыта страница системных логов');
    const controller = new AbortController();
    void fetchLogs(controller.signal);

    const timer = setInterval(() => {
      if (!isPaused) {
        void fetchLogs();
      }
    }, 2000);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [isPaused]);

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    if (!window.confirm('Очистить буфер системных логов?')) return;
    try {
      const res = await api.clearLogs();
      if (res && res.logs) setLogs(res.logs);
      frontendLogger.info('[Логи] Администратор очистил консоль логов');
    } catch {}
  };

  const filteredLogs = logs.filter((log) => {
    if (categoryFilter !== 'ALL' && log.category !== categoryFilter) {
      return false;
    }
    if (levelFilter !== 'ALL' && log.level !== levelFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchMsg = log.message.toLowerCase().includes(q);
      const matchCat = log.category.toLowerCase().includes(q);
      const matchLvl = log.level.toLowerCase().includes(q);
      const matchDet = log.details && JSON.stringify(log.details).toLowerCase().includes(q);
      return matchMsg || matchCat || matchLvl || matchDet;
    }
    return true;
  });

  const handleCopy = () => {
    const text = filteredLogs
      .map((l) => `[${l.timeFormatted}] [${l.category}] [${l.level}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.category}] [${l.level}] ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tanbox-crm-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = {
    total: logs.length,
    backend: logs.filter((l) => l.category === 'BACKEND').length,
    frontend: logs.filter((l) => l.category === 'FRONTEND').length,
    whatsapp: logs.filter((l) => l.category === 'WHATSAPP').length,
    errors: logs.filter((l) => l.level === 'ERROR').length,
  };

  return (
    <div className="w-full h-full flex flex-col space-y-4">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0">
            <Terminal className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">
                Системные логи TANBOX CRM
              </h2>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-800 border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Живой стрим (LIVE)</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Сквозное логирование всех слоев: Бэкенд (Express API / БД Prisma), Фронтенд (React / UI ошибки) и WhatsApp Multi-Device
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-sm transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать (.txt)</span>
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Очистить</span>
          </button>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
        <button
          type="button"
          onClick={() => {
            setCategoryFilter('ALL');
            setLevelFilter('ALL');
          }}
          className={`p-3 rounded-xl border text-left transition-colors ${
            categoryFilter === 'ALL' && levelFilter === 'ALL'
              ? 'bg-[#0082FB] text-white border-[#0082FB]'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <span className="text-[11px] opacity-80 block">Все события:</span>
          <span className="text-lg font-bold tabular-nums">{stats.total}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCategoryFilter('BACKEND');
            setLevelFilter('ALL');
          }}
          className={`p-3 rounded-xl border text-left transition-colors ${
            categoryFilter === 'BACKEND'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] opacity-80">
            <Server className="w-3 h-3" />
            <span>Бэкенд (API):</span>
          </div>
          <span className="text-lg font-bold tabular-nums">{stats.backend}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCategoryFilter('FRONTEND');
            setLevelFilter('ALL');
          }}
          className={`p-3 rounded-xl border text-left transition-colors ${
            categoryFilter === 'FRONTEND'
              ? 'bg-purple-600 text-white border-purple-600'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] opacity-80">
            <Layout className="w-3 h-3" />
            <span>Фронтенд (UI):</span>
          </div>
          <span className="text-lg font-bold tabular-nums">{stats.frontend}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCategoryFilter('WHATSAPP');
            setLevelFilter('ALL');
          }}
          className={`p-3 rounded-xl border text-left transition-colors ${
            categoryFilter === 'WHATSAPP'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] opacity-80">
            <MessageCircle className="w-3 h-3" />
            <span>WhatsApp:</span>
          </div>
          <span className="text-lg font-bold tabular-nums">{stats.whatsapp}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setLevelFilter('ERROR');
            setCategoryFilter('ALL');
          }}
          className={`p-3 rounded-xl border text-left transition-colors ${
            levelFilter === 'ERROR'
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] opacity-80">
            <AlertTriangle className="w-3 h-3 text-red-500" />
            <span>Ошибки:</span>
          </div>
          <span className={`text-lg font-bold tabular-nums ${stats.errors > 0 ? 'text-red-600' : ''}`}>
            {stats.errors}
          </span>
        </button>
      </div>

      {/* Main Terminal Window */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl flex-1 flex flex-col min-h-[560px] shadow-2xl overflow-hidden">
        {/* Terminal Header & Filters */}
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            </div>
            <span className="text-xs font-mono font-bold text-slate-200">
              tanbox-crm@server: /var/log/system.log
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск по тексту логов…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1 bg-slate-800/90 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#0082FB]"
              />
            </div>

            {/* Level Filter */}
            <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setLevelFilter('ALL')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  levelFilter === 'ALL'
                    ? 'bg-[#0082FB] text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setLevelFilter('ERROR')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  levelFilter === 'ERROR'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Ошибки
              </button>
              <button
                type="button"
                onClick={() => setLevelFilter('WARN')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  levelFilter === 'WARN'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Предупреждения
              </button>
            </div>

            {/* Pause toggle */}
            <button
              type="button"
              onClick={() => setIsPaused(!isPaused)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                isPaused
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {isPaused ? '▶ Возобновить' : '⏸ Пауза'}
            </button>
          </div>
        </div>

        {/* Terminal Screen Body */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed space-y-1 select-text">
          {filteredLogs.length === 0 ? (
            <div className="py-24 text-center text-slate-600 space-y-2">
              <p>Нет логов, соответствующих выбранным фильтрам</p>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('ALL');
                  setLevelFilter('ALL');
                  setSearch('');
                }}
                className="text-xs text-[#0082FB] hover:underline"
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isError = log.level === 'ERROR';
              const isWarn = log.level === 'WARN';
              const isWA = log.category === 'WHATSAPP' || log.level === 'WHATSAPP';
              const isFrontend = log.category === 'FRONTEND';
              const isBackend = log.category === 'BACKEND';
              const isCRM = log.category === 'CRM';

              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-2.5 py-0.5 px-2 rounded hover:bg-slate-900 transition-colors ${
                    isError
                      ? 'text-red-400 bg-red-950/20'
                      : isWarn
                        ? 'text-amber-300 bg-amber-950/20'
                        : isWA
                          ? 'text-emerald-300'
                          : isFrontend
                            ? 'text-purple-300'
                            : isCRM
                              ? 'text-sky-300'
                              : 'text-slate-300'
                  }`}
                >
                  <span className="text-slate-500 tabular-nums shrink-0 select-none">
                    {log.timeFormatted}
                  </span>

                  <span
                    className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded select-none shrink-0 ${
                      isBackend
                        ? 'bg-blue-900/80 text-blue-200 border border-blue-700'
                        : isFrontend
                          ? 'bg-purple-900/80 text-purple-200 border border-purple-700'
                          : isWA
                            ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-700'
                            : isCRM
                              ? 'bg-sky-900/80 text-sky-200 border border-sky-700'
                              : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {log.category}
                  </span>

                  {isError && (
                    <span className="text-[9px] font-bold px-1 rounded bg-red-900 text-red-100 select-none shrink-0">
                      ERR
                    </span>
                  )}
                  {isWarn && (
                    <span className="text-[9px] font-bold px-1 rounded bg-amber-900 text-amber-100 select-none shrink-0">
                      WARN
                    </span>
                  )}

                  <span className="whitespace-pre-wrap break-all flex-1">
                    {log.message}
                  </span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Terminal Status Footer */}
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center gap-3">
            <span>
              Записей: {filteredLogs.length} из {logs.length}
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-[#0082FB]"
              />
              <span>Автопрокрутка вниз</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-emerald-400">
              {isPaused ? '⏸ Поток приостановлен' : '● Стрим активен (каждые 2 сек)'}
            </span>
            <button
              type="button"
              onClick={() => void fetchLogs()}
              className="text-[#0082FB] hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Обновить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


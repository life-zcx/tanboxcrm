import React from 'react';
import { UploadCloud, Send, PanelLeftClose, PanelLeftOpen, Menu } from 'lucide-react';
import { AIStatus } from '../api';

interface HeaderProps {
  title: string;
  subtitle?: string;
  aiStatus: AIStatus | null;
  onOpenUpload: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onOpenUpload,
  aiStatus,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenMobileMenu,
}) => {
  const geminiLabel =
    aiStatus?.providers.gemini.state === 'ready'
      ? 'готов'
      : aiStatus?.providers.gemini.state === 'unconfigured'
        ? 'не настроен'
        : 'недоступен';

  return (
    <header className="bg-white border-b border-slate-200 h-14 px-4 lg:px-6 flex items-center justify-between gap-3 shrink-0 z-20">
      <div className="flex items-center gap-2.5 min-w-0">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Открыть меню"
            className="md:hidden p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
            title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            className="hidden md:inline-flex p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold text-slate-900 tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <span
          className={`hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${
            aiStatus?.providers.gemini.state === 'ready'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-slate-50 text-slate-600 border-slate-200'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              aiStatus?.providers.gemini.state === 'ready'
                ? 'bg-emerald-500'
                : 'bg-amber-500'
            }`}
          />
          Gemini: {geminiLabel}
        </span>

        <a
          href="https://t.me/tanboxcrmbot"
          target="_blank"
          rel="noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold hover:border-[#0082FB] hover:text-[#0082FB] transition-colors"
        >
          <Send className="w-3.5 h-3.5 text-[#0082FB]" />
          @tanboxcrmbot
        </a>

        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold transition-colors"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Загрузить переписку</span>
          <span className="sm:hidden">Загрузить</span>
        </button>
      </div>
    </header>
  );
};

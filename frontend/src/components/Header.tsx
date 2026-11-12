import React from 'react';
import { PanelLeftClose, PanelLeftOpen, Menu } from 'lucide-react';
import { AIStatus } from '../api';

interface HeaderProps {
  title: string;
  subtitle?: string;
  aiStatus?: AIStatus | null;
  onOpenUpload?: () => void;
  onOpenWhatsApp?: () => void;
  whatsAppStatus?: string;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenMobileMenu,
}) => {
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
    </header>
  );
};

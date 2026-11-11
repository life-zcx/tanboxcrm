import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  UploadCloud,
  BookOpen,
  Globe,
  ShieldCheck,
  Tag,
  ExternalLink,
  Send,
  LogOut,
  X,
} from 'lucide-react';
import { AdminUser, AIStatus } from '../api';

interface SidebarProps {
  aiStatus: AIStatus | null;
  currentTab: 'kanban' | 'clients' | 'ingest' | 'knowledge';
  user: AdminUser | null;
  onLogout: () => void;
  collapsed?: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  isActive: (pathname: string) => boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Продажи и CRM',
    items: [
      {
        to: '/deals',
        label: 'Канбан сделок',
        icon: LayoutDashboard,
        isActive: (p) => p === '/' || p.startsWith('/deals'),
      },
      {
        to: '/clients',
        label: 'Клиенты',
        icon: Users,
        isActive: (p) => p.startsWith('/clients'),
      },
      {
        to: '/ingest',
        label: 'Загрузка переписок',
        icon: UploadCloud,
        badge: 'WA',
        isActive: (p) => p === '/ingest',
      },
    ],
  },
  {
    title: 'База знаний и правила',
    items: [
      {
        to: '/knowledge',
        label: 'База знаний',
        icon: BookOpen,
        isActive: (p) =>
          p === '/knowledge' || p.startsWith('/knowledge/documents'),
      },
      {
        to: '/knowledge/web',
        label: 'Законы и источники РК',
        icon: Globe,
        isActive: (p) => p.startsWith('/knowledge/web'),
      },
      {
        to: '/knowledge/rules',
        label: 'Правила менеджеров',
        icon: ShieldCheck,
        isActive: (p) => p.startsWith('/knowledge/rules'),
      },
      {
        to: '/knowledge/playbook',
        label: 'Тарифы и возражения',
        icon: Tag,
        isActive: (p) => p.startsWith('/knowledge/playbook'),
      },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  onLogout,
  aiStatus,
  collapsed = false,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const { pathname } = useLocation();

  const content = (isCollapsed: boolean) => (
    <div className="flex flex-col justify-between h-full">
      <div className="space-y-4">
        {/* Brand Header */}
        <div
          className={`flex items-center border-b border-slate-200 pb-3 ${
            isCollapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/tanbox-dark.svg"
              alt="tanbox"
              className={isCollapsed ? 'h-5 w-auto' : 'h-6 w-auto'}
            />
            {!isCollapsed && (
              <span className="bg-[#0F172A] text-white text-[10px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wider">
                CRM
              </span>
            )}
          </div>
          {!isCollapsed && (
            <div className="flex items-center gap-1">
              <a
                href="https://tanbox.kz"
                target="_blank"
                rel="noopener noreferrer"
                title="Открыть tanbox.kz"
                className="p-1 rounded text-slate-400 hover:text-[#0082FB] hover:bg-slate-100 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              {onCloseMobile && (
                <button
                  type="button"
                  onClick={onCloseMobile}
                  aria-label="Закрыть меню"
                  className="md:hidden p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="space-y-5" aria-label="Основная навигация">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              {!isCollapsed && (
                <div className="px-2.5 pb-1 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.isActive(pathname);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => onCloseMobile?.()}
                      title={isCollapsed ? item.label : undefined}
                      className={`w-full flex items-center ${
                        isCollapsed ? 'justify-center px-2' : 'justify-between px-2.5'
                      } py-2 rounded-lg text-[13px] font-medium transition-colors ${
                        active
                          ? 'bg-[#0082FB] text-white font-semibold'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            active ? 'text-white' : 'text-slate-500'
                          }`}
                        />
                        {!isCollapsed && <span className="truncate">{item.label}</span>}
                      </div>
                      {!isCollapsed && item.badge && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            active
                              ? 'bg-white/20 text-white'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom User Profile & Logout */}
      <div className="pt-3 border-t border-slate-200 space-y-2.5">
        {user && !isCollapsed && (
          <div className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 truncate">
                @{user.telegramUsername || 'Менеджер'}
              </span>
              <span className="text-[10px] font-medium text-emerald-700">В сети</span>
            </div>
            <p className="text-[11px] text-slate-500 tabular-nums">
              ID: {user.telegramChatId}
            </p>
          </div>
        )}

        <div
          className={`flex items-center ${
            isCollapsed ? 'justify-center' : 'justify-between px-2'
          } text-xs text-slate-500`}
        >
          <a
            href="https://t.me/tanboxcrmbot"
            target="_blank"
            rel="noreferrer"
            title="@tanboxcrmbot"
            className="flex items-center gap-1.5 text-[#0082FB] font-semibold hover:underline"
          >
            <Send className="w-3.5 h-3.5 shrink-0" />
            {!isCollapsed && <span>@tanboxcrmbot</span>}
          </a>
          {!isCollapsed && (
            <span
              className={`w-2 h-2 rounded-full ${
                aiStatus?.telegramBot.running ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              title={
                aiStatus?.telegramBot.running
                  ? 'Telegram-бот работает'
                  : 'Бот недоступен или статус не получен'
              }
            />
          )}
        </div>

        <button
          type="button"
          onClick={onLogout}
          title={isCollapsed ? 'Выйти из CRM' : undefined}
          className="w-full flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          {!isCollapsed && <span>Выйти из CRM</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-white border-r border-slate-200 h-screen sticky top-0 p-3 transition-[width] duration-150 z-30 overflow-y-auto ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {content(collapsed)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[85vw] bg-white h-full border-r border-slate-200 p-4 z-10 overflow-y-auto">
            {content(false)}
          </aside>
        </div>
      )}
    </>
  );
};

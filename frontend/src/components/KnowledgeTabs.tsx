import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Globe, ShieldCheck, Tag } from 'lucide-react';

const KNOWLEDGE_TABS = [
  {
    to: '/knowledge',
    label: 'Архив материалов',
    icon: BookOpen,
    match: (path: string) =>
      path === '/knowledge' || path.startsWith('/knowledge/documents'),
  },
  {
    to: '/knowledge/web',
    label: 'Законы и источники РК',
    icon: Globe,
    match: (path: string) => path.startsWith('/knowledge/web'),
  },
  {
    to: '/knowledge/rules',
    label: 'Правила менеджеров',
    icon: ShieldCheck,
    match: (path: string) => path.startsWith('/knowledge/rules'),
  },
  {
    to: '/knowledge/playbook',
    label: 'Тарифы и возражения',
    icon: Tag,
    match: (path: string) => path.startsWith('/knowledge/playbook'),
  },
];

export const KnowledgeTabs: React.FC = () => {
  const { pathname } = useLocation();

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 flex items-center gap-1 overflow-x-auto">
      {KNOWLEDGE_TABS.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              active
                ? 'bg-[#0082FB] text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
};


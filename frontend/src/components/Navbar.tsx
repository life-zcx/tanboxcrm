import React from 'react';
import { Bot, Sparkles, Send, UploadCloud, BookOpen, Layers, Users } from 'lucide-react';
import { AIStatus } from '../api';

interface NavbarProps {
  currentTab: 'kanban' | 'clients' | 'ingest' | 'knowledge';
  setCurrentTab: (tab: 'kanban' | 'clients' | 'ingest' | 'knowledge') => void;
  aiStatus: AIStatus | null;
  onOpenUpload: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  aiStatus,
  onOpenUpload,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40 px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
        
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-black text-xl">
            T
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight text-white">TANBOX</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-semibold border border-indigo-500/20">
                AI CRM
              </span>
            </div>
            <p className="text-xs text-slate-400">Маркировка ИС МПТ & WhatsApp Копилот</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center bg-slate-950/70 p-1 rounded-xl border border-slate-800 text-sm">
          <button
            onClick={() => setCurrentTab('kanban')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
              currentTab === 'kanban'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            Канбан сделок
          </button>

          <button
            onClick={() => setCurrentTab('clients')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
              currentTab === 'clients'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            Клиенты
          </button>

          <button
            onClick={() => setCurrentTab('ingest')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
              currentTab === 'ingest'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            AI Анализатор
          </button>

          <button
            onClick={() => setCurrentTab('knowledge')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
              currentTab === 'knowledge'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            База знаний
          </button>
        </div>

        {/* AI Engine Status Badges & Quick Action */}
        <div className="flex items-center gap-3">
          {/* Status Badges */}
          <div className="hidden lg:flex items-center gap-2 text-xs">
            <div
              title={aiStatus?.providers.gemini.configured ? 'Google Gemini подключен' : 'Укажите GOOGLE_GEMINI_API_KEY в .env'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                aiStatus?.providers.gemini.configured
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-amber-950/40 text-amber-300 border-amber-800/40'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${aiStatus?.providers.gemini.configured ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              Gemini Vision
            </div>

            <div
              title={aiStatus?.providers.openai.configured ? 'ChatGPT подключен' : 'Укажите OPENAI_API_KEY в .env'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                aiStatus?.providers.openai.configured
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Bot className="w-3 h-3" />
              GPT-4o
            </div>

            <div
              title={aiStatus?.telegramBot.configured ? 'Telegram-бот активен' : 'Укажите TELEGRAM_BOT_TOKEN в .env'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                aiStatus?.telegramBot.configured
                  ? 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Send className="w-3 h-3" />
              ТГ-Бот
            </div>
          </div>

          {/* Quick upload screenshot button */}
          <button
            onClick={onOpenUpload}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-medium text-xs md:text-sm px-3.5 py-2 rounded-xl shadow-md shadow-indigo-600/25 transition active:scale-95"
          >
            <UploadCloud className="w-4 h-4" />
            Загрузить скриншот
          </button>
        </div>

      </div>
    </header>
  );
};


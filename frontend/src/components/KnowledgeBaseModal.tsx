import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Plus, Search, Tag, ArrowRight, X } from 'lucide-react';
import { api } from '../api';
import { KnowledgeTabs } from './KnowledgeTabs';

const RULE_CATEGORIES: Record<string, string> = {
  TARIFFS: 'Тарифы и цены',
  OBJECTIONS: 'Отработка возражений',
  IS_MPT_RULES: 'Правила ИС МПТ (РК)',
  STICKERING: 'Стикеровка и этикетки',
  FAQ: 'Частые вопросы',
};

export const KnowledgeBaseView: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [category, setCategory] = useState('TARIFFS');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [offset, setOffset] = useState(0);

  // Local filters (UI-only over loaded page)
  const [filterQuery, setFilterQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

  const loadKnowledge = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getKnowledge(offset);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить правила');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadKnowledge();
  }, [offset]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.createKnowledgeItem({
        category,
        title,
        content,
        reviewStatus: approved ? 'APPROVED' : 'DRAFT',
      });
      setTitle('');
      setContent('');
      setApproved(false);
      setShowAddModal(false);
      await loadKnowledge();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить правило');
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = useMemo(() => {
    const items = data?.customKnowledgeItems || [];
    const q = filterQuery.trim().toLowerCase();
    return items.filter((item: any) => {
      if (filterCategory !== 'ALL' && item.category !== filterCategory) return false;
      if (filterStatus !== 'ALL' && item.reviewStatus !== filterStatus) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q)
      );
    });
  }, [data, filterQuery, filterCategory, filterStatus]);

  return (
    <div className="space-y-4">
      <KnowledgeTabs />

      {/* Top Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#0082FB]" />
            <span>Правила менеджеров и регламенты ответов</span>
          </h2>
          <p className="text-xs text-slate-500 max-w-3xl">
            ИИ использует только подтверждённые коммерческие правила. Нормативные основания
            подтягиваются из базы законов РК с источниками. Черновики не проверены, не используются
            ИИ и не должны отправляться клиенту как готовый ответ.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/knowledge/playbook"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:border-[#0082FB] text-xs font-semibold text-slate-700"
          >
            <Tag className="w-3.5 h-3.5 text-[#0082FB]" />
            <span>Тарифы и возражения</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить регламент</span>
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between"
        >
          <span>{error}</span>
          <button type="button" className="underline font-semibold" onClick={loadKnowledge}>
            Повторить
          </button>
        </p>
      )}

      {/* Filter & Pagination Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Фильтр по заголовку или тексту правила..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
            />
          </div>

          <select
            aria-label="Категория правила"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0082FB]"
          >
            <option value="ALL">Все категории</option>
            {Object.entries(RULE_CATEGORIES).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>

          <select
            aria-label="Статус проверки"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0082FB]"
          >
            <option value="ALL">Все статусы</option>
            <option value="APPROVED">Подтверждено менеджером</option>
            <option value="DRAFT">Черновик — не используется ИИ</option>
          </select>
        </div>

        <div className="flex items-center gap-3 text-xs tabular-nums">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Назад
          </button>
          <span className="text-slate-600 font-medium">{data?.total || 0} правил</span>
          <button
            type="button"
            disabled={offset + 50 >= (data?.total || 0)}
            onClick={() => setOffset((n) => n + 50)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Далее
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400 text-xs">Загрузка базы знаний…</div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-xs text-slate-500">
          Правила по выбранным условиям не найдены.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {filteredItems.map((item: any) => {
            const isApproved = item.reviewStatus === 'APPROVED';
            return (
              <article
                key={item.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                      {RULE_CATEGORIES[item.category] || item.category}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded font-semibold border ${
                        isApproved
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {isApproved ? 'Подтверждено менеджером' : 'Черновик — не используется ИИ'}
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-slate-900 leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {item.content}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <form
            onSubmit={handleCreate}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Новый регламент в базу знаний
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">Категория</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-900 font-semibold rounded-lg px-3 py-2 focus:outline-none focus:border-[#0082FB]"
              >
                <option value="TARIFFS">Тарифы и цены</option>
                <option value="OBJECTIONS">Отработка возражений</option>
                <option value="IS_MPT_RULES">Правила ИС МПТ (РК)</option>
                <option value="STICKERING">Стикеровка и этикетки</option>
                <option value="FAQ">Частые вопросы</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">Заголовок</label>
              <input
                required
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Порядок согласования индивидуальной скидки"
                className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-900 rounded-lg px-3 py-2 focus:outline-none focus:border-[#0082FB] focus:bg-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">
                Текст правила / аргументации
              </label>
              <textarea
                required
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Опишите правило, которое ИИ должен учитывать при подготовке ответов..."
                className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-900 rounded-lg px-3 py-2 focus:outline-none focus:border-[#0082FB] focus:bg-white"
              />
            </div>

            <label className="flex gap-2 items-center text-xs text-slate-700">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              <span>Коммерческое правило проверено мной; использовать в ответах</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white"
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

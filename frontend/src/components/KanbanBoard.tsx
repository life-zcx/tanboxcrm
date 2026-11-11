import React, { useMemo, useState } from 'react';
import { Deal, Client } from '../api';
import {
  ChevronRight,
  ChevronLeft,
  Phone,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import { CATEGORY_LABELS, formatCategory, formatPhoneDigits } from '../utils/labels';

interface KanbanBoardProps {
  counts: Record<string, number>;
  totals: Record<string, number>;
  onLoadMore: (stage: string) => void;
  deals: Deal[];
  onMoveStage: (dealId: string, nextStage: string) => void;
  onSelectClient: (client: Client) => void;
}

export const STAGES = [
  { id: 'NEW', label: 'Новые лиды', badge: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400', icon: Clock },
  { id: 'QUALIFIED', label: 'В переговорах', badge: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500', icon: MessageSquare },
  { id: 'OFFER_SENT', label: 'КП отправлено', badge: 'bg-blue-50 text-[#0082FB]', dot: 'bg-[#0082FB]', icon: AlertCircle },
  { id: 'INVOICED', label: 'Счет на оплате', badge: 'bg-teal-50 text-teal-800', dot: 'bg-teal-500', icon: Clock },
  { id: 'PAID', label: 'Оплачено / В работе', badge: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', icon: CheckCircle2 },
  { id: 'CLOSED_LOST', label: 'Отказ', badge: 'bg-red-50 text-red-700', dot: 'bg-red-500', icon: AlertCircle },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  deals,
  onMoveStage,
  onSelectClient,
  counts,
  totals,
  onLoadMore,
}) => {
  const [boardSearch, setBoardSearch] = useState('');
  const [boardCategory, setBoardCategory] = useState('ALL');
  const [hideLost, setHideLost] = useState(false);

  const hasLocalFilter = boardSearch.trim() !== '' || boardCategory !== 'ALL';

  const visibleStages = useMemo(
    () => (hideLost ? STAGES.filter((s) => s.id !== 'CLOSED_LOST') : STAGES),
    [hideLost]
  );

  const filteredDeals = useMemo(() => {
    const q = boardSearch.trim().toLowerCase();
    return deals.filter((d) => {
      if (boardCategory !== 'ALL' && d.client?.category !== boardCategory) {
        return false;
      }
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        (d.client?.name || '').toLowerCase().includes(q) ||
        (d.client?.company || '').toLowerCase().includes(q) ||
        (d.client?.phone || '').includes(q)
      );
    });
  }, [deals, boardSearch, boardCategory]);

  const getStageDeals = (stageId: string) =>
    filteredDeals.filter((d) => d.stage === stageId);

  const totalActiveCount = STAGES.filter((s) => s.id !== 'CLOSED_LOST').reduce(
    (sum, s) => sum + (counts[s.id] ?? deals.filter((d) => d.stage === s.id).length),
    0
  );

  const totalActiveAmount = STAGES.filter((s) => s.id !== 'CLOSED_LOST').reduce(
    (sum, s) =>
      sum +
      (totals[s.id] ??
        deals
          .filter((d) => d.stage === s.id)
          .reduce((acc, d) => acc + (d.amount || 0), 0)),
    0
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Board Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={boardSearch}
              onChange={(e) => setBoardSearch(e.target.value)}
              placeholder="Фильтр по сделке, клиенту, компании..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0082FB] focus:bg-white transition-colors"
            />
            {boardSearch && (
              <button
                type="button"
                onClick={() => setBoardSearch('')}
                aria-label="Сбросить фильтр"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Фильтр категории на доске"
            value={boardCategory}
            onChange={(e) => setBoardCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#0082FB]"
          >
            <option value="ALL">Все категории</option>
            {Object.entries(CATEGORY_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setHideLost((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              hideLost
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {hideLost ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{hideLost ? 'Показать «Отказ»' : 'Скрыть «Отказ»'}</span>
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-600 tabular-nums">
          <span>
            Активных сделок: <strong className="text-slate-900">{totalActiveCount}</strong>
          </span>
          <span>
            Сумма воронки:{' '}
            <strong className="text-[#0082FB]">
              {totalActiveAmount.toLocaleString('ru-RU')} ₸
            </strong>
          </span>
        </div>
      </div>

      {/* Horizontal 6-Column Board */}
      <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto pb-1">
        {visibleStages.map((stage) => {
          const fullIdx = STAGES.findIndex((s) => s.id === stage.id);
          const stageDeals = getStageDeals(stage.id);
          const localAmount = stageDeals.reduce((acc, d) => acc + (d.amount || 0), 0);
          const totalAmount = hasLocalFilter ? localAmount : totals[stage.id] ?? localAmount;
          const totalCount = hasLocalFilter ? stageDeals.length : counts[stage.id] ?? stageDeals.length;
          const StageIcon = stage.icon;

          return (
            <section
              key={stage.id}
              aria-label={stage.label}
              className="min-w-[265px] flex-1 bg-slate-50/90 border border-slate-200 rounded-xl flex flex-col min-h-[420px] overflow-hidden"
            >
              {/* Column Header */}
              <div className="bg-white border-b border-slate-200 px-3.5 py-2.5 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${stage.dot}`} />
                    <StageIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <h2 className="font-semibold text-xs text-slate-900 truncate">
                      {stage.label}
                    </h2>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 font-semibold text-slate-700 tabular-nums">
                    {totalCount}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500 flex items-center justify-between tabular-nums">
                  <span>Сумма этапа</span>
                  <span className="font-semibold text-slate-900">
                    {Number(totalAmount).toLocaleString('ru-RU')} ₸
                  </span>
                </div>
              </div>

              {/* Cards List */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {stageDeals.map((deal) => {
                  const client = deal.client;
                  if (!client) return null;
                  const waDigits = formatPhoneDigits(client.phone);

                  return (
                    <div
                      key={deal.id}
                      onClick={() => onSelectClient(client)}
                      className="bg-white border border-slate-200 hover:border-[#0082FB] rounded-lg p-3 transition-colors cursor-pointer group flex flex-col gap-2"
                    >
                      {/* Title & Category */}
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold text-xs text-slate-900 group-hover:text-[#0082FB] transition-colors line-clamp-2 leading-snug">
                          {deal.title}
                        </h4>
                        {client.category && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                            {formatCategory(client.category)}
                          </span>
                        )}
                      </div>

                      {/* Client & Company */}
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600 truncate">
                        <User className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate font-medium">
                          {client.name}
                          {client.company ? ` (${client.company})` : ''}
                        </span>
                      </div>

                      {/* Amount & Codes */}
                      <div className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-md bg-slate-50 border border-slate-200/80 tabular-nums">
                        <span className="text-[#0082FB] font-semibold">
                          {deal.amount ? `${deal.amount.toLocaleString('ru-RU')} ₸` : 'Без суммы'}
                        </span>
                        <span className="text-slate-500 text-[11px]">
                          {deal.codesCount ? `${deal.codesCount.toLocaleString('ru-RU')} шт` : '—'}
                        </span>
                      </div>

                      {/* Next Step */}
                      {client.aiNextStep && (
                        <div className="text-[11px] bg-blue-50/70 border border-blue-200/70 text-slate-700 px-2.5 py-1.5 rounded-md leading-snug flex items-start gap-1.5">
                          <ArrowRight className="w-3 h-3 text-[#0082FB] shrink-0 mt-0.5" />
                          <span className="line-clamp-2">{client.aiNextStep}</span>
                        </div>
                      )}

                      {/* Controls */}
                      <div
                        className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {waDigits ? (
                          <a
                            href={`https://wa.me/${waDigits}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200 transition-colors"
                          >
                            <Phone className="w-3 h-3" />
                            <span>WhatsApp</span>
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-400">Без номера</span>
                        )}

                        <div className="flex items-center gap-1">
                          {fullIdx > 0 && (
                            <button
                              type="button"
                              onClick={() => onMoveStage(deal.id, STAGES[fullIdx - 1].id)}
                              className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition-colors"
                              title={`Переместить в «${STAGES[fullIdx - 1].label}»`}
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {fullIdx < STAGES.length - 1 && (
                            <button
                              type="button"
                              onClick={() => onMoveStage(deal.id, STAGES[fullIdx + 1].id)}
                              className="p-1 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0082FB] transition-colors"
                              title={`Переместить в «${STAGES[fullIdx + 1].label}»`}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!hasLocalFilter && stageDeals.length < (counts[stage.id] || 0) && (
                  <button
                    type="button"
                    className="w-full py-2 text-xs font-semibold text-[#0082FB] bg-white border border-slate-200 rounded-lg hover:border-[#0082FB] transition-colors"
                    onClick={() => onLoadMore(stage.id)}
                  >
                    Загрузить ещё
                  </button>
                )}

                {stageDeals.length === 0 && (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Нет сделок на этом этапе
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

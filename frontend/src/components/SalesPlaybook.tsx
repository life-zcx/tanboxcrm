import React, { useEffect, useState } from 'react';
import { Tag, ShieldCheck, Copy, Check, ExternalLink, Layers } from 'lucide-react';
import { api } from '../api';
import { KnowledgeTabs } from './KnowledgeTabs';
import { formatMoney } from '../utils/labels';

const TARIFF_NAMES: Record<string, string> = {
  DIGITAL: 'Цифровой',
  PRINT: 'Печать',
  STANDARD: 'Стандарт',
  PRO: 'PRO Склад',
};

const OBJECTION_TITLES: Record<string, string> = {
  дорого: '«Дорого, у других дешевле»',
  сами_сделаем: '«Мы сами сделаем через ИС МПТ»',
  сроки: '«Нужно срочно / какие сроки?»',
  каспи_требует: '«Требования Kaspi Магазина»',
};

export const SalesPlaybook: React.FC = () => {
  const [knowledge, setKnowledge] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.allSettled([api.getKnowledge(0), api.getPricing(controller.signal)])
      .then(([k, p]) => {
        if (controller.signal.aborted) return;
        if (k.status === 'fulfilled') setKnowledge(k.value.hardcodedKnowledge);
        else setError(k.reason.message || 'Не удалось загрузить регламенты');
        if (p.status === 'fulfilled') setSnapshot(p.value.snapshot);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setError('Не удалось скопировать текст.');
    }
  };

  const pricing = snapshot?.pricing;
  const settings = pricing?.pricingSettings;

  return (
    <div className="space-y-4">
      <KnowledgeTabs />

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Tag className="w-4 h-4 text-[#0082FB]" />
            <span>Тарифы, прайс-лист и отработка возражений TANBOX</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Справочник услуг и типовых ответов менеджера. Точный расчёт под партию выполняется в
            карточке клиента на вкладке «Расчёт стоимости».
          </p>
        </div>
        {knowledge?.jurisdiction && (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
            {knowledge.jurisdiction}
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between"
        >
          <span>{error}</span>
          <button
            type="button"
            className="underline font-semibold"
            onClick={() => setReload((n) => n + 1)}
          >
            Повторить
          </button>
        </p>
      )}

      {loading && (
        <p role="status" className="text-xs text-slate-500 py-4">
          Загрузка тарифов и справочника…
        </p>
      )}

      {!loading && knowledge && (
        <div className="space-y-4">
          {/* Tariff Packages */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Состав услуг TANBOX</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                {
                  key: 'digital',
                  title: 'Тариф «Цифровой»',
                  text: knowledge.tariffs?.digital,
                },
                {
                  key: 'print',
                  title: 'Тариф «Печать»',
                  text: knowledge.tariffs?.print,
                },
                {
                  key: 'stickering',
                  title: 'Нанесение и агрегация',
                  text: knowledge.tariffs?.stickering,
                },
                {
                  key: 'accountService',
                  title: 'Карточки и кабинет',
                  text: knowledge.tariffs?.accountService,
                },
              ]
                .filter((t) => t.text)
                .map((t) => (
                  <div
                    key={t.key}
                    className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5"
                  >
                    <h4 className="text-xs font-bold text-[#0082FB]">{t.title}</h4>
                    <p className="text-xs text-slate-700 leading-relaxed">{t.text}</p>
                  </div>
                ))}
            </div>
          </section>

          {/* Public Pricing Table */}
          {pricing && settings && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Публичная сетка тарифов (серверный снимок)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ступенчатый расчёт. Коды оператора, склад и таможенный брокер оплачиваются
                    отдельно.
                  </p>
                </div>
                {snapshot && (
                  <span className="text-[11px] text-slate-500">
                    Проверено: {new Date(snapshot.checkedAt).toLocaleString('ru-RU')} ·{' '}
                    <a
                      href={snapshot.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#0082FB] font-semibold hover:underline inline-flex items-center gap-1"
                    >
                      <span>Источник</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                <div className="xl:col-span-7 overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="px-3.5 py-2.5 font-semibold">Пакет</th>
                        <th className="px-3.5 py-2.5 font-semibold tabular-nums">
                          До {settings.volumeTier1.toLocaleString('ru-RU')} ед.
                        </th>
                        <th className="px-3.5 py-2.5 font-semibold tabular-nums">
                          {(settings.volumeTier1 + 1).toLocaleString('ru-RU')} –{' '}
                          {settings.volumeTier2.toLocaleString('ru-RU')} ед.
                        </th>
                        <th className="px-3.5 py-2.5 font-semibold tabular-nums">
                          Свыше {settings.volumeTier2.toLocaleString('ru-RU')} ед.
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {pricing.tariffs.map((t: any) => (
                        <tr key={t.code}>
                          <td className="px-3.5 py-2.5 font-semibold text-slate-900">
                            {TARIFF_NAMES[t.code] || t.code}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700">
                            {formatMoney(t.priceRetail)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700">
                            {formatMoney(t.priceWholesale)}
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-[#0082FB]">
                            {formatMoney(t.priceLargeWholesale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="xl:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  {[
                    ['Карточка (полный пакет)', formatMoney(settings.cardFullPackagePrice)],
                    ['Карточка НКТ', formatMoney(settings.cardNktPrice)],
                    ['Карточка ИС МПТ', formatMoney(settings.cardMptPrice)],
                    ['Агрегация SSCC (короб)', formatMoney(settings.ssccPrice)],
                    ['Разработка макета', formatMoney(settings.stickerLayoutPrice)],
                    ['Проверка макета', formatMoney(settings.selfLayoutPrice)],
                    ['Сопровождение (разово)', formatMoney(settings.outsourcingOneTimePrice)],
                    ['Экспресс-доставка', formatMoney(settings.expressDeliveryPrice)],
                    ['Наценка за срочность', `+${settings.urgentPercent}%`],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-600">{label}</span>
                      <strong className="text-slate-900 tabular-nums shrink-0">{val}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Objection Playbook */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Отработка частых возражений клиентов</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(knowledge.objectionPlaybook || {}).map(([key, text]) => (
                <div
                  key={key}
                  className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-slate-900">
                      {OBJECTION_TITLES[key] || key}
                    </h4>
                    <p className="text-xs text-slate-700 leading-relaxed">{String(text)}</p>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void copyText(key, String(text))}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded border border-slate-200 bg-white hover:border-[#0082FB] text-slate-700"
                    >
                      {copiedKey === key ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedKey === key ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Categories */}
          {Array.isArray(knowledge.categories) && knowledge.categories.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#0082FB]" />
                <span>Направления маркировки ({knowledge.categories.length})</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {knowledge.categories.map((cat: string) => (
                  <span
                    key={cat}
                    className="text-xs px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 font-medium"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};


import React, { useEffect, useState } from 'react';
import { Calculator, Copy, CheckCircle2, ExternalLink, Ban, FileText } from 'lucide-react';
import { api } from '../api';

const defaults = {
  tariff: 'STANDARD',
  itemsCount: 0,
  cardsCount: 0,
  cardService: 'NONE',
  onboarding: false,
  ssccNeeded: false,
  boxesCount: 0,
  layout: 'NONE',
  urgent: false,
  delivery: false,
  discountAmount: 0,
  discountReason: '',
};

const names: Record<string, string> = {
  DIGITAL: 'Цифровой',
  PRINT: 'Печать',
  STANDARD: 'Стандарт',
  PRO: 'PRO Склад',
};

const money = (n: number | string) =>
  Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₸';

const inputClass =
  'mt-1 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0082FB] w-full text-xs font-medium text-slate-900 transition-colors';

export function ClientPricing({
  clientId,
  onSelect,
}: {
  clientId: string;
  onSelect: (id: string) => void;
}) {
  const [input, setInput] = useState(defaults);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    setInput(defaults);
    setSelected(null);
    setSnapshot(null);
    setNotice('');
    setOffset(0);
  }, [clientId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSnapshot(null);
    Promise.allSettled([
      api.getPricing(controller.signal),
      api.getQuotes(clientId, offset, controller.signal),
    ])
      .then(([p, q]) => {
        if (controller.signal.aborted) return;
        if (p.status === 'fulfilled') setSnapshot(p.value.snapshot);
        else setError(p.reason.message);
        if (q.status === 'fulfilled') {
          setQuotes(q.value.quotes);
          setTotal(q.value.total);
        } else setError(q.reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [clientId, offset, reload]);

  const update = (key: keyof typeof defaults, value: string | number | boolean) => {
    setInput((p) => ({ ...p, [key]: value }));
    setSelected(null);
  };

  const calculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setSelected(null);
    try {
      const r = await api.createQuote(clientId, input);
      setSelected(r.quote);
      setOffset(0);
      setReload((n) => n + 1);
      setNotice(
        'Расчёт сохранён. Он не меняет сумму сделки и не отправляется клиенту автоматически.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить расчёт');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (q: any) => {
    const c = q.calculation;
    const text = [
      'Предварительный расчёт TANBOX',
      c.tariffName + ' · ' + c.input.itemsCount.toLocaleString('ru-RU') + ' ед.',
      ...c.lines.map((l: any) => l.title + ': ' + money(l.total)),
      ...(c.discountAmount
        ? [
            'До скидки: ' + money(c.beforeDiscount),
            'Скидка: ' + money(c.discountAmount),
          ]
        : []),
      'Итого услуги: ' + money(c.total),
      '',
      ...c.notes,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Расчёт скопирован вместе с условиями.');
    } catch {
      setError('Не удалось скопировать. Откройте расчёт и выделите текст вручную.');
    }
  };

  const usable = (q: any) =>
    !q.revokedAt &&
    Date.parse(q.reviewAfter) > Date.now() &&
    snapshot?.hash === q.pricingHash;

  return (
    <section className="space-y-4" aria-label="Расчёт услуг TANBOX">
      {/* Info Header */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5 text-xs text-slate-600">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[#0082FB]" />
            <span>Расчёт стоимости услуг</span>
          </h3>
          {snapshot && (
            <span className="text-[11px] text-slate-500">
              Прайс проверен: {new Date(snapshot.checkedAt).toLocaleString('ru-RU')} ·{' '}
              <a
                className="text-[#0082FB] font-medium hover:underline inline-flex items-center gap-1"
                href={snapshot.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>Источник TANBOX</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          )}
        </div>
        <p>
          Укажите количество единиц конкретной партии. Годовой объём клиента автоматически не
          подставляется.
        </p>
        <p>
          Цена считается ступенчато. Коды оператора, склад и брокер оплачиваются отдельно;
          налоговый статус цены требует уточнения.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 p-3.5 rounded-xl flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            className="underline font-semibold shrink-0"
            onClick={() => setReload((n) => n + 1)}
          >
            Повторить загрузку
          </button>
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 p-3 rounded-xl"
        >
          {notice}
        </p>
      )}

      {loading && (
        <p role="status" className="text-xs text-slate-500 py-2">
          Загрузка прайса и истории…
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Calculator Form */}
        <form
          onSubmit={calculate}
          className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-3.5">
            <label className="text-xs font-semibold text-slate-700 block">
              Пакет
              <select
                aria-label="Пакет"
                className={inputClass}
                value={input.tariff}
                onChange={(e) => {
                  setInput((p) => ({
                    ...p,
                    tariff: e.target.value,
                    ssccNeeded: e.target.value === 'PRO',
                    boxesCount: 0,
                  }));
                  setSelected(null);
                }}
              >
                {Object.entries(names).map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-700 block">
              Единиц в партии
              <input
                required
                type="number"
                min={1}
                max={10000000}
                step={1}
                className={inputClass}
                value={input.itemsCount || ''}
                onChange={(e) => update('itemsCount', Number(e.target.value))}
              />
            </label>

            <label className="text-xs font-semibold text-slate-700 block">
              Карточки товаров
              <select
                aria-label="Карточки товаров"
                className={inputClass}
                value={input.cardService}
                onChange={(e) => {
                  setInput((p) => ({
                    ...p,
                    cardService: e.target.value,
                    cardsCount: 0,
                  }));
                  setSelected(null);
                }}
              >
                <option value="NONE">Не включать</option>
                <option value="FULL">Полный пакет карточек</option>
                <option value="NKT">Только НКТ</option>
                <option value="MPT">Только ИС МПТ</option>
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-700 block">
              Количество карточек
              <input
                required={input.cardService !== 'NONE'}
                disabled={input.cardService === 'NONE'}
                type="number"
                min={1}
                max={100000}
                step={1}
                className={`${inputClass} disabled:opacity-50`}
                value={input.cardsCount || ''}
                onChange={(e) => update('cardsCount', Number(e.target.value))}
              />
            </label>

            <label className="text-xs font-semibold text-slate-700 block">
              Макет
              <select
                aria-label="Макет"
                className={inputClass}
                value={input.layout}
                onChange={(e) => update('layout', e.target.value)}
              >
                <option value="NONE">Не включать</option>
                <option value="DESIGN">Разработать макет</option>
                <option value="APPROVAL">Проверить макет клиента</option>
              </select>
            </label>

            {input.ssccNeeded && input.tariff !== 'PRO' && (
              <label className="text-xs font-semibold text-slate-700 block">
                Количество коробов для SSCC
                <input
                  required
                  type="number"
                  min={1}
                  max={1000000}
                  step={1}
                  className={inputClass}
                  value={input.boxesCount || ''}
                  onChange={(e) => update('boxesCount', Number(e.target.value))}
                />
              </label>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-2.5 pt-1 text-xs text-slate-700">
            {(
              [
                ['onboarding', 'Первоначальное сопровождение'],
                ['urgent', 'Срочность'],
                ['delivery', 'Экспресс-доставка'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex gap-2 items-center p-2 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer hover:bg-slate-100/70"
              >
                <input
                  type="checkbox"
                  checked={input[key]}
                  onChange={(e) => update(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
            <label className="flex gap-2 items-center p-2 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer hover:bg-slate-100/70">
              <input
                type="checkbox"
                disabled={input.tariff === 'PRO'}
                checked={input.ssccNeeded}
                onChange={(e) => {
                  setInput((p) => ({
                    ...p,
                    ssccNeeded: e.target.checked,
                    boxesCount: 0,
                  }));
                  setSelected(null);
                }}
              />
              <span>Агрегация SSCC{input.tariff === 'PRO' ? ' — входит в PRO' : ''}</span>
            </label>
          </div>

          {input.tariff === 'PRO' && (
            <p className="text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Минимальная партия PRO Склад — 500 единиц.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-3.5 pt-1 border-t border-slate-100">
            <label className="text-xs font-semibold text-slate-700 block">
              Скидка по решению менеджера, ₸
              <input
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                className={inputClass}
                value={input.discountAmount}
                onChange={(e) => update('discountAmount', Number(e.target.value))}
              />
            </label>
            <label className="text-xs font-semibold text-slate-700 block">
              Причина скидки
              <input
                required={input.discountAmount > 0}
                maxLength={500}
                className={inputClass}
                value={input.discountReason}
                onChange={(e) => update('discountReason', e.target.value)}
                placeholder="Обязательна при скидке"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={busy || loading || !snapshot}
            className="w-full bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold px-4 py-2.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {busy ? 'Расчёт…' : 'Рассчитать и сохранить'}
          </button>
        </form>

        {/* Right: Active Quote & History */}
        <div className="lg:col-span-6 space-y-4">
          {selected && (
            <article
              className="bg-white border border-blue-200 rounded-xl p-4 space-y-3"
              data-testid="commercial-quote"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <h3 className="font-bold text-sm text-slate-900">
                  {selected.calculation.tariffName} ·{' '}
                  {selected.calculation.input.itemsCount.toLocaleString('ru-RU')} ед.
                </h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#0082FB] border border-blue-200">
                  Сохранённый расчёт
                </span>
              </div>

              <table className="text-xs w-full">
                <tbody className="divide-y divide-slate-100">
                  {selected.calculation.lines.map((l: any) => (
                    <tr key={l.key}>
                      <td className="py-1.5 text-slate-700">{l.title}</td>
                      <td className="py-1.5 text-right font-semibold text-slate-900 tabular-nums">
                        {money(l.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <details className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                  Ступени расчёта маркировки
                </summary>
                <div className="mt-2 space-y-1 text-xs text-slate-600 tabular-nums">
                  {selected.calculation.brackets.map((b: any, i: number) => (
                    <p key={i}>
                      {b.count.toLocaleString('ru-RU')} × {money(b.rate)} ={' '}
                      <strong>{money(b.subtotal)}</strong>
                    </p>
                  ))}
                </div>
              </details>

              {selected.calculation.discountAmount > 0 && (
                <p className="text-xs text-slate-600 bg-amber-50/70 border border-amber-200 rounded-lg px-3 py-2">
                  До скидки: {money(selected.calculation.beforeDiscount)} · Скидка:{' '}
                  <strong>{money(selected.calculation.discountAmount)}</strong>. Причина:{' '}
                  {selected.calculation.discountReason}
                </p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-600">Итого услуги</span>
                <p className="font-bold text-lg text-[#0082FB] tabular-nums">
                  Итого услуги: {money(selected.calculation.total)}
                </p>
              </div>

              <div className="space-y-1 pt-1">
                {selected.calculation.notes.map((n: string) => (
                  <p key={n} className="text-[11px] text-slate-500">
                    {n}
                  </p>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                  onClick={() => void copy(selected)}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Скопировать расчёт</span>
                </button>
                <button
                  type="button"
                  disabled={!usable(selected)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] disabled:bg-slate-200 disabled:text-slate-400 text-xs font-semibold text-white"
                  onClick={() => onSelect(selected.id)}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Использовать в ответе</span>
                </button>
              </div>
            </article>
          )}

          {/* History Panel */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                История расчётов: {total}
              </h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Новая сумма сохраняется отдельной версией. Для подсказок расчёт
                перепроверяется по прайсу; через сутки нужен новый расчёт. Это не срок
                действия коммерческого предложения.
              </p>
            </div>

            {quotes.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-slate-200/80">
                Сохранённых расчётов пока нет
              </div>
            ) : (
              <div className="space-y-2.5">
                {quotes.map((q) => {
                  const isUsable = usable(q);
                  return (
                    <div
                      key={q.id}
                      className={`border rounded-lg p-3 text-xs space-y-2 ${
                        selected?.id === q.id
                          ? 'border-[#0082FB] bg-blue-50/30'
                          : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-slate-800 tabular-nums">
                          {new Date(q.createdAt).toLocaleString('ru-RU')} ·{' '}
                          {q.calculation.tariffName} ·{' '}
                          {q.calculation.input.itemsCount.toLocaleString('ru-RU')} ед. ·{' '}
                          <strong className="text-slate-900">{money(q.total)}</strong>
                        </p>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                            q.revokedAt
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : isUsable
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {q.revokedAt
                            ? 'Исключён из подсказок'
                            : isUsable
                              ? 'Можно использовать в ответе'
                              : 'Требует нового расчёта'}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#0082FB] hover:underline"
                          onClick={() => setSelected(q)}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Открыть расчёт</span>
                        </button>
                        {!q.revokedAt && (
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                            onClick={async () => {
                              setBusy(true);
                              setError('');
                              try {
                                await api.revokeQuote(q.id);
                                if (selected?.id === q.id)
                                  setSelected({
                                    ...q,
                                    revokedAt: new Date().toISOString(),
                                  });
                                setReload((n) => n + 1);
                              } catch (e) {
                                setError(
                                  e instanceof Error ? e.message : 'Ошибка отзыва'
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Исключить из подсказок</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <button
                type="button"
                disabled={offset === 0 || loading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Назад
              </button>
              <button
                type="button"
                disabled={offset + quotes.length >= total || loading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                onClick={() => setOffset(offset + 20)}
              >
                Следующие
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

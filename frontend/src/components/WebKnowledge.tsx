import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Globe, Search, RefreshCw, ExternalLink, Download, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { KnowledgeTabs } from './KnowledgeTabs';
import { formatConditions } from '../utils/labels';

const panel = 'bg-white border border-slate-200 rounded-xl p-5';
const states: Record<string, string> = {
  READY: 'Текст получен',
  PENDING: 'В очереди',
  NEEDS_OCR: 'Требуется OCR',
  OCR_UNREVIEWED: 'OCR: проверить текст',
  NEEDS_BROWSER: 'Текст недоступен',
  FETCH_ERROR: 'Ошибка загрузки',
  HTTP_ERROR: 'Ошибка HTTP',
  UNEXPECTED_CONTENT: 'Получена другая страница',
  BINARY_STORED: 'Сохранён файл',
  PARSE_ERROR: 'Ошибка извлечения',
  NEEDS_REVIEW: 'Нужна проверка',
};

export function WebKnowledge() {
  const { revisionId } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [document, setDocument] = useState<any>(null);
  const [integrity, setIntegrity] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any>(null);
  const [listCode, setListCode] = useState('');
  const [listResult, setListResult] = useState<any>(null);
  const [listError, setListError] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [showSupporting, setShowSupporting] = useState(false);
  const [sourcePage, setSourcePage] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const category = params.get('category') || '';
  const status = params.get('status') || '';

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    setDocument(null);
    const load = revisionId
      ? api.getWebKnowledgeDocument(revisionId, controller.signal).then((r) => {
          setDocument(r.document);
          setIntegrity(r.integrity);
        })
      : api.getWebKnowledge(controller.signal).then(setData);
    load
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revisionId, revision]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setResults(null);
    setSourcePage(0);
  };

  const find = async () => {
    setBusy(true);
    setError('');
    try {
      setResults(await api.searchWebKnowledge(search, category));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска');
    } finally {
      setBusy(false);
    }
  };

  const lookupCode = async () => {
    setListBusy(true);
    setListError('');
    setListResult(null);
    try {
      setListResult(await api.lookupMarkingList(listCode.trim()));
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Не удалось открыть перечень');
    } finally {
      setListBusy(false);
    }
  };

  const collect = async () => {
    setBusy(true);
    try {
      await api.collectWebKnowledge();
      setNotice('Запущена проверка очереди источников. Результаты появятся в журнале.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка запуска');
    } finally {
      setBusy(false);
    }
  };

  const sources = (data?.sources || []).filter(
    (s: any) =>
      (showSupporting || !s.supportingTechnical) &&
      (!category ||
        s.categoryCodes.includes(category) ||
        s.categoryCodes.includes('GENERAL')) &&
      (!status || s.status === status)
  );
  const sourcePageSize = 40;
  const sourcePages = Math.max(1, Math.ceil(sources.length / sourcePageSize));
  const visibleSourcePage = Math.min(sourcePage, sourcePages - 1);
  const pageSources = sources.slice(visibleSourcePage * sourcePageSize, (visibleSourcePage + 1) * sourcePageSize);

  return (
    <div className="space-y-4">
      <KnowledgeTabs />

      {/* Header */}
      <div className={panel}>
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#0082FB]" />
              <span>Маркировка в Казахстане: источники и проверка</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Официальные документы, инструкции и полнота исследования по категориям. Получение
              текста и проверка утверждений учитываются раздельно.
            </p>
          </div>
          <Link to="/knowledge" className="text-xs font-semibold text-[#0082FB] hover:underline">
            Архив проекта TANBOX
          </Link>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 p-4 rounded-xl flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            className="underline font-semibold shrink-0"
            onClick={() => setRevision((n) => n + 1)}
          >
            Повторить
          </button>
        </p>
      )}

      {loading && (
        <p role="status" className="text-xs text-slate-500 py-4">
          Загрузка базы…
        </p>
      )}

      {/* Document Reader */}
      {!loading && document && (
        <div className="space-y-4">
          <Link
            to="/knowledge/web"
            className="inline-flex items-center text-xs font-semibold text-[#0082FB] hover:underline"
          >
            ← К источникам и матрице
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-4">
              <div className={panel + ' space-y-3'}>
                <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                  {states[document.source.currentRevisionId === document.id ? document.source.status : document.quality] || (document.source.currentRevisionId === document.id ? document.source.status : document.quality)}
                </span>
                {document.source.currentRevisionId === document.id && document.source.lastError && (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
                    {document.source.status === 'READY' && 'Последняя повторная проверка не удалась; сохранённый текст доступен. '}
                    {document.source.lastError}
                  </p>
                )}
                <h3 className="text-base font-bold text-slate-900 leading-snug">
                  {document.source.title}
                </h3>

                <div className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-slate-100 tabular-nums">
                  <p>Загружен: {new Date(document.fetchedAt).toLocaleString('ru-RU')}</p>
                  <p className="flex items-center gap-1.5">
                    <CheckCircle2
                      className={`w-3.5 h-3.5 ${
                        integrity ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    />
                    <span>
                      {integrity ? 'Контрольные суммы совпали' : 'Ошибка целостности'}
                    </span>
                  </p>
                  <p>
                    {document.text.length.toLocaleString('ru-RU')} символов · разделов:{' '}
                    {document._count.passages}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 break-all">
                    SHA-256: {document.sha256}
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 text-xs font-semibold">
                  <a
                    className="inline-flex items-center gap-1.5 text-[#0082FB] hover:underline break-all"
                    href={document.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span>Открыть источник</span>
                  </a>
                  <a
                    className="inline-flex items-center gap-1.5 text-[#0082FB] hover:underline"
                    href={'/api/settings/knowledge/web/documents/' + document.id + '/raw'}
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Скачать сохранённый оригинал</span>
                  </a>
                </div>

                <p className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed">
                  Этот текст — исходный документ. В ответы ИИ допускаются отдельно проверенные
                  утверждения с условиями и ссылками на редакцию.{' '}
                  {document.source.currentRevisionId !== document.id
                    ? 'Открыта предыдущая редакция.'
                    : ''}
                </p>

                <details className="border-t border-slate-100 pt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                    Метаданные, страницы и обнаруженные ссылки
                  </summary>
                  <pre className="whitespace-pre-wrap break-all text-[11px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5 mt-2 max-h-80 overflow-y-auto">
                    {JSON.stringify(document.metadata, null, 2)}
                  </pre>
                </details>
              </div>
            </aside>

            <article className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
              <div
                data-testid="web-knowledge-text"
                className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 max-w-4xl"
              >
                {document.text ||
                  'Из файла не удалось получить полный текст. Оригинал сохранён; требуется дополнительная обработка.'}
              </div>
            </article>
          </div>
        </div>
      )}

      {/* Overview */}
      {!loading && !revisionId && data && (
        <div className="space-y-4">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              [data.coreStats?.sources ?? data.stats.sources, 'Источников по маркировке'],
              [data.coreStats?.collected ?? data.stats.collected, 'Текстов по маркировке'],
              [data.coreStats?.pending ?? data.stats.pending, 'Ожидают загрузки'],
              [data.coreStats?.attention ?? data.stats.attention, 'Требуют внимания'],
              [data.stats.publishedFacts, 'Проверенных правил'],
            ].map(([n, label]) => (
              <div className="bg-white border border-slate-200 rounded-xl p-4" key={String(label)}>
                <strong className="text-xl font-bold text-slate-900 tabular-nums block">
                  {n}
                </strong>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Справочные технические материалы ЕАЭС: {data.supportingStats?.sources ?? 0} источников.
            Они сохранены отдельно от показателей маркировки и доступны в реестре по переключателю.
            {' '}Общие файлы оператора, размещённые сразу в нескольких категориях: {data.sharedDocumentCount ?? 0};
            они доступны для чтения, но не засчитываются как исследование конкретной категории.
          </p>

          {/* Queue & Search */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void collect()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:border-[#0082FB] text-xs font-semibold text-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#0082FB]" />
                  <span>Проверить очередь источников</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRevision((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-[#0082FB] text-xs font-semibold text-[#0082FB]"
                >
                  Обновить показатели
                </button>
              </div>

              {notice && (
                <p
                  role="status"
                  className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2.5"
                >
                  {notice}
                </p>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Планировщик проверяет очередь каждую минуту. Интервал повторной проверки — сутки
                для ключевых источников и неделя для инструкций. Новая редакция приостанавливает
                связанные проверенные правила до повторной проверки.
              </p>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void find();
                }}
                className="flex flex-wrap gap-2.5"
              >
                <input
                  aria-label="Поиск в официальных материалах"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  minLength={2}
                  maxLength={500}
                  placeholder="Вопрос или термин: импорт обуви, возврат, Data Matrix…"
                  className="border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0082FB] rounded-lg px-3.5 py-2 text-xs flex-1 min-w-[220px]"
                />
                <button
                  type="submit"
                  disabled={busy || search.trim().length < 2}
                  className="bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Найти</span>
                </button>
              </form>

              <div className="flex flex-wrap gap-2.5">
                <select
                  aria-label="Категория интернет-базы"
                  className="border border-slate-200 px-3 py-2 rounded-lg bg-slate-50 text-xs font-medium text-slate-800 focus:outline-none focus:border-[#0082FB]"
                  value={category}
                  onChange={(e) => update('category', e.target.value)}
                >
                  <option value="">Все категории</option>
                  {data.categories.map((c: any) => (
                    <option key={c.code} value={c.code}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Статус источника"
                  className="border border-slate-200 px-3 py-2 rounded-lg bg-slate-50 text-xs font-medium text-slate-800 focus:outline-none focus:border-[#0082FB]"
                  value={status}
                  onChange={(e) => update('status', e.target.value)}
                >
                  <option value="">Все статусы</option>
                  {Object.entries(states).map(([s, t]) => (
                    <option key={s} value={s}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Exact rows from the current official list */}
          <section className={panel + ' space-y-3'}>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Поиск в перечне № 199-НҚ по коду ТН ВЭД</h3>
              <p className="text-xs text-slate-600 mt-1">
                Показывает дословные строки официального перечня: наименование товара, дату и исключения.
                Совпадение кода само по себе не подтверждает обязанность для конкретной партии.
              </p>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); void lookupCode(); }}
              className="flex flex-wrap gap-2"
            >
              <input
                aria-label="Код ТН ВЭД для поиска в перечне"
                value={listCode}
                onChange={(e) => { setListCode(e.target.value); setListResult(null); setListError(''); }}
                placeholder="Например, 6401 или 2106 90 980 8"
                inputMode="numeric"
                maxLength={20}
                className="border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0082FB] rounded-lg px-3.5 py-2 text-xs flex-1 min-w-[220px]"
              />
              <button
                type="submit"
                disabled={listBusy || !/^[\d\s]+$/.test(listCode.trim()) || listCode.replace(/\D/g, '').length < 4}
                className="bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-semibold"
              >
                {listBusy ? 'Проверяю…' : 'Найти строку'}
              </button>
            </form>
            {listError && <p role="alert" className="text-xs text-red-700">{listError}</p>}
            {listResult && (
              <div className="space-y-3">
                <div className="text-xs text-slate-600 flex flex-wrap gap-3">
                  <span>Найдено строк: <strong>{listResult.total}</strong></span>
                  <Link to={'/knowledge/web/documents/' + listResult.revisionId} className="text-[#0082FB] hover:underline">
                    Сохранённая редакция
                  </Link>
                  <a href={listResult.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#0082FB] hover:underline">
                    Официальная страница
                  </a>
                </div>
                {!listResult.fresh && <p className="text-xs text-amber-800">Срок последней проверки источника истёк. Сверьте редакцию на официальном сайте.</p>}
                {listResult.total === 0 && <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg">В сохранённой редакции строка с этим кодом не найдена. Это не заключение об отсутствии обязанности: проверьте точный код и актуальный перечень.</p>}
                {listResult.rows.map((row: any, index: number) => (
                  <div key={`${row.number}-${row.matchedCode}-${index}`} className="border border-slate-200 rounded-lg p-3.5 space-y-1.5 text-xs">
                    <strong className="block text-slate-900">Позиция {row.number} · {row.code}</strong>
                    <p className="text-slate-700">{row.product}</p>
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{row.requirement}</p>
                    {(row.partialCode || row.matchType !== 'EXACT') && (
                      <p className="text-amber-800">{row.partialCode ? 'Позиция «из»: обязательно сопоставьте наименование товара. ' : ''}{row.matchType !== 'EXACT' ? 'Код в строке и введённый код имеют разную детализацию.' : ''}</p>
                    )}
                  </div>
                ))}
                {listResult.total > listResult.rows.length && <p className="text-xs text-slate-600">Показаны первые {listResult.rows.length} строк. Уточните код до 10 цифр.</p>}
              </div>
            )}
          </section>

          {/* Search Results */}
          {results && (
            <section className={panel + ' space-y-3'}>
              <h3 className="text-sm font-bold text-slate-900">
                Результаты: {results.passages.length} разделов, {results.evidence.length}{' '}
                проверенных правил
              </h3>
              {results.evidence.map((f: any) => {
                const conds = formatConditions(f.conditions);
                return (
                  <div
                    key={f.factId}
                    className="bg-blue-50/70 border border-blue-200 rounded-lg p-3.5 space-y-2"
                  >
                    <strong className="text-xs text-slate-900 block">{f.title}</strong>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {f.answer}
                    </p>
                    {conds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {conds.map((c, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] bg-white border border-blue-200 text-slate-700 px-2 py-0.5 rounded"
                          >
                            <span className="text-slate-500">{c.key}:</span> {c.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {results.passages.map((p: any) => (
                <div key={p.id} className="border-t border-slate-100 pt-3 space-y-1">
                  <Link
                    className="text-xs font-semibold text-[#0082FB] hover:underline"
                    to={'/knowledge/web/documents/' + p.revisionId}
                  >
                    {p.title} · раздел {p.position + 1}
                  </Link>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {p.content}
                  </p>
                  <p className="text-[11px] text-amber-800">
                    {p.quality === 'OCR_UNREVIEWED'
                      ? 'OCR: распознанный текст не сверен с оригинальным PDF. Не используйте даты и номера без проверки.'
                      : 'Исходный текст: требует проверки применимости.'}
                  </p>
                </div>
              ))}
            </section>
          )}

          {/* Coverage Matrix */}
          <section className={panel + ' space-y-3'}>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Матрица покрытия</h3>
              <p className="text-xs text-slate-500 mt-1">
                Число — доступные проверенные правила по теме. «Текст» — источники получены,
                проверка не завершена. «Пробел» — подходящих текстов пока нет.
              </p>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="text-xs w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600">
                    <th className="p-2.5 sticky left-0 bg-slate-50 z-10 border-r border-slate-200 font-semibold min-w-[160px]">
                      Категория
                    </th>
                    {Object.values(data.topics).map((t: any) => (
                      <th className="p-2.5 min-w-[100px] font-semibold" key={t}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.matrix
                    .filter((c: any) => !category || c.code === category)
                    .map((c: any) => (
                      <tr key={c.code}>
                        <th className="p-2.5 sticky left-0 bg-white z-10 border-r border-slate-200 font-semibold text-slate-800">
                          {c.title}
                        </th>
                        {c.topics.map((t: any) => (
                          <td
                            key={t.topic}
                            className={`p-2 border-l border-slate-100 text-center font-medium tabular-nums ${
                              t.reviewed
                                ? 'bg-blue-50 text-[#0082FB]'
                                : t.collected
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-red-50/70 text-red-700'
                            }`}
                          >
                            {t.reviewed ? `${t.reviewed} правил` : t.collected ? 'Текст' : 'Пробел'}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Source Registry */}
          <section className={panel + ' space-y-3'}>
            <div className="flex flex-wrap justify-between items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Реестр: {sources.length} источников</h3>
              <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                <input type="checkbox" checked={showSupporting} onChange={e=>{ setShowSupporting(e.target.checked); setSourcePage(0); }} />
                Показать справочные материалы ЕАЭС
              </label>
            </div>
            <div className="divide-y divide-slate-100">
              {pageSources.map((s: any) => (
                <div key={s.id} className="py-3 text-xs space-y-1">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <strong className="text-slate-900">{s.title}</strong>
                    {s.sharedDocument && <span className="text-[11px] text-slate-600">Общий документ</span>}
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                        s.status === 'READY'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {states[s.status] || s.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 break-all">
                    {s.authority} · {s.url}
                  </p>
                  {s.lastError && (
                    <p className="text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200 rounded px-2 py-1">
                      {s.status === 'READY' && 'Последняя повторная проверка не удалась; сохранённый текст доступен. '}
                      {s.lastError}
                    </p>
                  )}
                  <div className="flex gap-4 pt-0.5 text-xs font-semibold">
                    {s.currentRevisionId && (
                      <Link
                        className="text-[#0082FB] hover:underline"
                        to={'/knowledge/web/documents/' + s.currentRevisionId}
                      >
                        Открыть сохранённый документ
                      </Link>
                    )}
                    <a
                      className="text-[#0082FB] hover:underline"
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Источник
                    </a>
                  </div>
                </div>
              ))}
            </div>
            {sourcePages > 1 && (
              <nav aria-label="Страницы реестра источников" className="flex items-center justify-between gap-3 pt-2 text-xs text-slate-600">
                <button type="button" disabled={visibleSourcePage === 0} onClick={() => setSourcePage(visibleSourcePage - 1)} className="font-semibold text-[#0082FB] disabled:text-slate-400 disabled:cursor-not-allowed">Предыдущая страница</button>
                <span>Страница {visibleSourcePage + 1} из {sourcePages}</span>
                <button type="button" disabled={visibleSourcePage >= sourcePages - 1} onClick={() => setSourcePage(visibleSourcePage + 1)} className="font-semibold text-[#0082FB] disabled:text-slate-400 disabled:cursor-not-allowed">Следующая страница</button>
              </nav>
            )}
          </section>

          <details className={panel + ' text-xs'}>
            <summary className="cursor-pointer font-semibold text-slate-700">
              Последние запуски сбора
            </summary>
            <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-80 overflow-y-auto">
              {JSON.stringify(data.runs, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

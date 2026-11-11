import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Download,
  Search,
  ShieldCheck,
  FileText,
  ArrowLeft,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api';
import { KnowledgeTabs } from './KnowledgeTabs';

const kinds: Record<string, string> = {
  CATEGORY: 'Категория',
  ARTICLE: 'Статья',
  ORIGINAL: 'Исходная редакция',
  REFERENCES: 'Источники',
  FIELDS: 'Поля карточки',
  STICKER: 'Этикетка',
  FAQ: 'Частые вопросы',
  SERVICE_TEXT: 'Услуги',
  PRICING: 'Тарифы',
  TECHNICAL: 'Техническая документация',
};

const panel = 'bg-white border border-slate-200 rounded-xl p-5';
const inputClass =
  'border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0082FB]';
const formatNumber = (n: number) => n.toLocaleString('ru-RU');

export function KnowledgeLibrary() {
  const { documentId } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(params.get('search') || '');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [copiedText, setCopiedText] = useState(false);

  const category = params.get('category') || '';
  const language = params.get('language') || 'ru';
  const kind = params.get('kind') || '';
  const offset = Math.max(0, Math.min(1e7, Number(params.get('offset')) || 0));
  const version = params.get('importId') || '';
  const serialized = params.toString();

  useEffect(() => setSearch(params.get('search') || ''), [serialized]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setReport(null);
    setDocument(null);
    const load = documentId
      ? api.getKnowledgeDocument(documentId, controller.signal).then((r) => setDocument(r.document))
      : api
          .getKnowledgeLibrary(
            {
              category,
              language,
              kind,
              search: params.get('search') || '',
              offset,
              limit: 20,
              importId: version,
            },
            controller.signal
          )
          .then(setData);
    load
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [documentId, serialized, revision]);

  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete('offset');
    for (const [k, v] of Object.entries(values)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };

  const check = async () => {
    if (checking || !data?.archive) return;
    setChecking(true);
    setError('');
    try {
      setReport(await api.verifyKnowledgeLibrary(data.archive.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка проверки');
    } finally {
      setChecking(false);
    }
  };

  const copyDoc = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      setError('Не удалось скопировать текст. Выделите содержимое вручную.');
    }
  };

  const archive = data?.archive;
  const manifest = archive?.manifest;
  const coverage = manifest?.coverage;
  const back = '/knowledge' + (serialized ? '?' + serialized : '');

  return (
    <div className="space-y-4">
      <KnowledgeTabs />

      {/* Top Page Banner */}
      <div className={panel}>
        <div className="flex flex-wrap justify-between gap-4 items-center">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#0082FB]" />
              <span>Полная база знаний TANBOX</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Полные тексты, исходные файлы, FAQ, инструкции и редакции по категориям маркировки.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link className="text-[#0082FB] hover:underline" to="/knowledge/web">
              Источники из интернета и проверка
            </Link>
            <span className="text-slate-300">|</span>
            <Link className="text-[#0082FB] hover:underline" to="/knowledge/rules">
              Правила менеджеров
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-medium flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            className="underline font-semibold shrink-0"
            onClick={() => setRevision((n) => n + 1)}
          >
            Повторить загрузку
          </button>
        </div>
      )}

      {loading && (
        <p role="status" className="text-xs text-slate-500 py-4">
          Загрузка материалов…
        </p>
      )}

      {/* Document Reader View */}
      {!loading && document && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0082FB] hover:underline"
              to={back}
            >
              ← К материалам базы знаний
            </Link>
            <button
              type="button"
              onClick={() => void copyDoc(document.content)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-[#0082FB] text-xs font-semibold text-slate-700"
            >
              {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedText ? 'Текст скопирован' : 'Копировать полный текст'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Metadata & Sources */}
            <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-4">
              <div className={panel + ' space-y-3'}>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                    {kinds[document.kind] || document.kind}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-[#0082FB]">
                    {document.language.toUpperCase()}
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-900 leading-snug">
                  {document.title}
                </h3>

                <div className="text-[11px] text-slate-500 space-y-1 pt-2 border-t border-slate-100 tabular-nums">
                  <p>Снимок: {new Date(document.import.capturedAt).toLocaleString('ru-RU')}</p>
                  <p>Объём: {formatNumber(document.content.length)} символов</p>
                  <p className="break-all font-mono text-[10px] text-slate-400">
                    SHA-256: {document.sha256}
                  </p>
                </div>

                <div className="bg-amber-50 text-amber-900 border border-amber-200 rounded-lg p-3 text-xs leading-relaxed">
                  Материал сохранён из проекта. Целостность хранения проверена. Юридическая
                  актуальность и условия применения требуют отдельной проверки.
                  {document.issues.length > 0 && (
                    <ul className="list-disc pl-4 mt-2 space-y-1">
                      {document.issues.map((s: string, i: number) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <section className="border-t border-slate-100 pt-3 space-y-2">
                  <h4 className="text-xs font-bold text-slate-800">Исходники этой редакции</h4>
                  <ul className="space-y-1.5">
                    {document.sources.map((s: any) => (
                      <li key={s.id} className="text-xs flex items-center justify-between gap-2">
                        <a
                          className="text-[#0082FB] hover:underline truncate font-medium"
                          title={s.path}
                          href={'/api/settings/knowledge/library/sources/' + s.id}
                        >
                          {s.path}
                        </a>
                        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                          {formatNumber(s.byteLength)} Б
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <details className="border-t border-slate-100 pt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                    Полные структурированные данные
                  </summary>
                  <pre className="text-[11px] whitespace-pre-wrap break-words mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg max-h-80 overflow-y-auto font-mono text-slate-700">
                    {JSON.stringify(document.payload, null, 2)}
                  </pre>
                </details>
              </div>
            </aside>

            {/* Right Full-Text Sheet */}
            <article className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
              <div
                data-testid="knowledge-full-text"
                className="whitespace-pre-wrap break-words leading-relaxed text-sm text-slate-800 max-w-4xl"
              >
                {document.content}
              </div>
            </article>
          </div>
        </div>
      )}

      {/* Library Directory View */}
      {!loading &&
        !documentId &&
        (!archive ? (
          <div className={panel + ' text-xs text-slate-600'}>
            Полная база ещё не импортирована. Правила менеджеров доступны во вкладке выше.
          </div>
        ) : (
          <div className="space-y-4">
            {/* KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                [coverage.categories, 'Категорий'],
                [coverage.documents, 'Полных документов'],
                [coverage.sourceFiles, 'Исходных файлов'],
                [coverage.contentCharacters, 'Символов в текстах'],
              ].map(([n, label]) => (
                <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
                  <strong className="text-xl font-bold text-slate-900 tabular-nums block">
                    {formatNumber(Number(n))}
                  </strong>
                  <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Integrity & Export Bar */}
            <section className={panel + ' space-y-3'}>
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <p className="text-xs text-slate-600">
                  Снимок:{' '}
                  <strong className="text-slate-900 tabular-nums">
                    {new Date(archive.capturedAt).toLocaleString('ru-RU')}
                  </strong>
                  . Сверка проверяет исходные байты, тексты и поисковые разделы.
                </p>
                <div className="flex flex-wrap gap-2.5 text-xs">
                  <button
                    type="button"
                    disabled={checking}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:border-[#0082FB] text-slate-800 font-semibold disabled:opacity-50"
                    onClick={() => void check()}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0082FB]" />
                    <span>{checking ? 'Проверка…' : 'Проверить полноту хранения'}</span>
                  </button>
                  <a
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-[#0082FB] text-[#0082FB] font-semibold"
                    href={'/api/settings/knowledge/library/export?importId=' + archive.id}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Полный экспорт</span>
                  </a>
                </div>
              </div>

              {report && (
                <p
                  role="status"
                  className={`text-xs font-medium px-3 py-2 rounded-lg border ${
                    report.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {report.ok ? 'Сверка пройдена:' : 'Сверка не пройдена:'} {report.sourceFiles}{' '}
                  файлов, {report.documents} документов, {report.passages} разделов.{' '}
                  {report.ok ? 'Все контрольные суммы совпали.' : report.failures.join(', ')}
                </p>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-slate-700 hover:text-slate-900">
                  Охват и сохранённые исходники
                </summary>
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <p className="text-slate-600">
                    Перенесены материалы из перечисленных файлов проекта. Полнота переноса не
                    означает полноту законодательства или юридическую проверку каждого утверждения.
                  </p>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Категория</th>
                          <th className="px-3 py-2 font-semibold">Документы</th>
                          <th className="px-3 py-2 font-semibold">Символы</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {coverage.perCategory.map((c: any) => (
                          <tr key={c.code}>
                            <td className="px-3 py-1.5 font-medium text-slate-800">{c.title}</td>
                            <td className="px-3 py-1.5 text-slate-600">{c.documents}</td>
                            <td className="px-3 py-1.5 text-slate-600">
                              {formatNumber(c.characters)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="space-y-1.5 max-h-60 overflow-y-auto text-[11px] font-mono">
                    {data.sources.map((s: any) => (
                      <li key={s.id} className="text-slate-600">
                        <a
                          className="text-[#0082FB] hover:underline break-all"
                          href={'/api/settings/knowledge/library/sources/' + s.id}
                        >
                          {s.path}
                        </a>{' '}
                        · {formatNumber(s.byteLength)} байт ·{' '}
                        <span className="text-slate-400 break-all">{s.sha256}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </section>

            {/* 2-Column Workspace: Left Categories Rail + Right Materials */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Category Rail */}
              <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-3 space-y-2 lg:sticky lg:top-4">
                <div className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Категории
                </div>
                <nav
                  aria-label="Категории базы знаний"
                  className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-1 lg:pb-0"
                >
                  {[
                    { code: '', title: 'Все категории' },
                    ...manifest.categories,
                    { code: 'GENERAL', title: 'Общие материалы' },
                  ].map((c: any) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => update({ category: c.code })}
                      className={`text-left px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap lg:whitespace-normal transition-colors ${
                        category === c.code
                          ? 'bg-[#0082FB] text-white font-semibold'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {c.title}
                    </button>
                  ))}
                </nav>
              </aside>

              {/* Right Documents Area */}
              <div className="lg:col-span-9 space-y-4">
                {/* Search & Select Filters */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    update({ search });
                  }}
                  className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap gap-2.5 items-center"
                >
                  <input
                    aria-label="Поиск по полным текстам"
                    placeholder="Вопрос, товар или термин..."
                    className={inputClass + ' flex-1 min-w-[200px]'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    maxLength={200}
                  />
                  <select
                    aria-label="Язык материала"
                    className={inputClass}
                    value={language}
                    onChange={(e) => update({ language: e.target.value })}
                  >
                    <option value="ru">Русский</option>
                    <option value="kz">Қазақша</option>
                    <option value="en">English</option>
                    <option value="mixed">Тексты страниц услуг</option>
                    <option value="ALL">Все языки</option>
                  </select>
                  <select
                    aria-label="Тип материала"
                    className={inputClass}
                    value={kind}
                    onChange={(e) => update({ kind: e.target.value })}
                  >
                    <option value="">Все типы</option>
                    {Object.entries(kinds).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {data.versions.length > 1 && (
                    <select
                      aria-label="Версия базы"
                      value={version || data.versions[0].id}
                      className={inputClass}
                      onChange={(e) => update({ importId: e.target.value })}
                    >
                      {data.versions.map((v: any) => (
                        <option key={v.id} value={v.id}>
                          {new Date(v.capturedAt).toLocaleString('ru-RU')}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    className="bg-[#0082FB] hover:bg-[#0070D8] text-white rounded-lg px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Найти</span>
                  </button>
                </form>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Сохранённые материалы требуют проверки перед использованием как действующие
                      правовые требования.
                    </span>
                  </p>
                  <p className="text-slate-600 font-medium tabular-nums">
                    Найдено: {data.total}. Показано {data.total ? offset + 1 : 0}–
                    {Math.min(offset + 20, data.total)}.
                  </p>
                </div>

                {/* Documents Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {data.documents.map((d: any) => (
                    <Link
                      key={d.id}
                      to={'/knowledge/documents/' + d.id + (serialized ? '?' + serialized : '')}
                      className="bg-white border border-slate-200 hover:border-[#0082FB] rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors group"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {kinds[d.kind] || d.kind}
                          </span>
                          <span className="text-slate-400">{d.language.toUpperCase()}</span>
                        </div>
                        <h3 className="font-semibold text-xs text-slate-900 group-hover:text-[#0082FB] flex items-start gap-2 leading-snug">
                          <FileText className="w-4 h-4 text-[#0082FB] shrink-0 mt-0.5" />
                          <span>{d.title}</span>
                        </h3>
                        {d.issues.length > 0 && (
                          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            Есть замечания для проверки
                          </p>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-[#0082FB]">
                        Открыть полный материал →
                      </p>
                    </Link>
                  ))}
                </div>

                {data.total === 0 && (
                  <p className={panel + ' text-center text-xs text-slate-500'}>
                    Материалы по этому запросу не найдены. Измените запрос или язык.
                  </p>
                )}

                {/* Pagination */}
                <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    disabled={offset === 0}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set('offset', String(Math.max(0, offset - 20)));
                      setParams(next);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Назад
                  </button>
                  <span className="text-slate-500 tabular-nums">
                    Страница {Math.floor(offset / 20) + 1}
                  </span>
                  <button
                    type="button"
                    disabled={offset + 20 >= data.total}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set('offset', String(offset + 20));
                      setParams(next);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Далее
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

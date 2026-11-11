import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Routes,
  Route,
  Navigate,
  Link,
  matchPath,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { KanbanBoard, STAGES } from './components/KanbanBoard';
import { ClientsList } from './components/ClientsList';
import { ScreenshotUploader } from './components/ScreenshotUploader';
import { KnowledgeBaseView } from './components/KnowledgeBaseModal';
import { KnowledgeLibrary } from './components/KnowledgeLibrary';
import { WebKnowledge } from './components/WebKnowledge';
import { SalesPlaybook } from './components/SalesPlaybook';
import { ClientDetailModal } from './components/ClientDetailModal';
import { LoginPage } from './components/LoginPage';
import { api, ApiError, Client, Deal, AIStatus, AdminUser } from './api';

type Tab = 'kanban' | 'clients' | 'ingest' | 'knowledge';

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const clientId = matchPath('/clients/:clientId', location.pathname)?.params.clientId;
  const tab: Tab = location.pathname.startsWith('/clients')
    ? 'clients'
    : location.pathname === '/ingest'
      ? 'ingest'
      : location.pathname.startsWith('/knowledge')
        ? 'knowledge'
        : 'kanban';

  const [user, setUser] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [clients, setClients] = useState<Client[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Client | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tanbox_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const filters = useMemo(
    () => ({
      search: query.get('search') || '',
      status: query.get('status') || 'ALL',
      category: query.get('category') || 'ALL',
    }),
    [query]
  );
  const page = Math.max(1, Math.min(200000, Number(query.get('page')) || 1));
  const offset = (Math.floor(page) - 1) * 50;
  const [clientTotal, setClientTotal] = useState(0);
  const requestVersion = useRef(0);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tanbox_sidebar_collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const refresh = () => setRevision((v) => v + 1);
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      setUser(null);
      setClients([]);
      setDeals([]);
      setSelected(null);
    } else {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить данные');
    }
  };

  useEffect(() => {
    try {
      localStorage.removeItem('tanbox_crm_token');
      localStorage.removeItem('tanbox_crm_user');
    } catch {}
    const invalid = () => {
      setUser(null);
      setSelected(null);
      setClients([]);
      setDeals([]);
    };
    window.addEventListener('tanbox-unauthorized', invalid);
    return () => window.removeEventListener('tanbox-unauthorized', invalid);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setSessionError('');
    api
      .getMe(controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setUser(r.user);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) setUser(null);
        else setSessionError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [sessionAttempt]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    const load = async () => {
      if (clientId) {
        setSelected(null);
        const r = await api.getClient(clientId, controller.signal);
        if (!controller.signal.aborted && version === requestVersion.current)
          setSelected(r.client);
      } else if (tab === 'kanban') {
        const pages = await Promise.all(
          STAGES.map((s) => api.getDeals({ stage: s.id, limit: 25 }, controller.signal))
        );
        if (controller.signal.aborted) return;
        setDeals(pages.flatMap((p) => p.deals));
        setCounts(Object.fromEntries(STAGES.map((s, i) => [s.id, pages[i].total])));
        setTotals(Object.fromEntries(STAGES.map((s, i) => [s.id, pages[i].amountTotal])));
      } else if (tab === 'clients' || tab === 'ingest') {
        const r = await api.getClients(
          tab === 'clients' ? { ...filters, offset, limit: 50 } : { limit: 50 },
          controller.signal
        );
        if (controller.signal.aborted) return;
        setClients(r.clients);
        setClientTotal(r.total);
      }
    };
    void load()
      .catch((e) => {
        if (!controller.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, tab, clientId, revision, filters, offset]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const load = () =>
      api
        .getAIStatus(controller.signal)
        .then(setStatus)
        .catch(() => {
          if (!controller.signal.aborted) setStatus(null);
        });
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [user, revision]);

  const knowledgeTitle = location.pathname.startsWith('/knowledge/web')
    ? 'Законы и источники РК'
    : location.pathname.startsWith('/knowledge/rules')
      ? 'Правила менеджеров'
      : location.pathname.startsWith('/knowledge/playbook')
        ? 'Тарифы и возражения'
        : 'База знаний TANBOX';

  const titles: Record<Tab, string> = {
    kanban: 'Воронка сделок и заказов',
    clients: clientId ? 'Карточка клиента' : 'Реестр клиентов и лидов',
    ingest: 'Загрузка переписки WhatsApp',
    knowledge: knowledgeTitle,
  };

  useEffect(() => {
    document.title =
      (location.pathname === '/login' ? 'Вход' : titles[tab]) + ' — TANBOX CRM';
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const select = (client: Client) =>
    navigate('/clients/' + client.id, {
      state: { returnTo: location.pathname + location.search },
    });

  const loadMore = async (stage: string) => {
    const version = requestVersion.current;
    try {
      const r = await api.getDeals({
        stage,
        offset: deals.filter((d) => d.stage === stage).length,
        limit: 25,
      });
      if (version === requestVersion.current)
        setDeals((prev) => [
          ...prev,
          ...r.deals.filter((d) => !prev.some((p) => p.id === d.id)),
        ]);
    } catch (e) {
      fail(e);
    }
  };

  const changeFilters = (values: typeof filters) => {
    const search = new URLSearchParams();
    if (values.search) search.set('search', values.search);
    if (values.status !== 'ALL') search.set('status', values.status);
    if (values.category !== 'ALL') search.set('category', values.category);
    if (
      values.search === filters.search &&
      values.status === filters.status &&
      values.category === filters.category
    )
      return;
    navigate({ pathname: '/clients', search: search.toString() }, { replace: true });
  };

  const changePage = (next: number) => {
    const search = new URLSearchParams(location.search);
    if (next <= 1) search.delete('page');
    else search.set('page', String(next));
    navigate({ pathname: '/clients', search: search.toString() });
  };

  const logout = async () => {
    try {
      await api.logout();
      setUser(null);
      setSelected(null);
      setClients([]);
      setDeals([]);
      navigate('/login', { replace: true });
    } catch (e) {
      fail(e);
    }
  };

  if (checking)
    return (
      <div className="min-h-screen flex items-center justify-center text-xs text-slate-500" role="status">
        Проверка входа…
      </div>
    );

  if (sessionError)
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full text-center space-y-4">
          <p role="alert" className="text-xs font-medium text-red-800">
            {sessionError}
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-[#0082FB] text-white text-xs font-semibold hover:bg-[#0070D8]"
            onClick={() => setSessionAttempt((n) => n + 1)}
          >
            Повторить подключение
          </button>
        </div>
      </div>
    );

  if (!user) {
    if (location.pathname !== '/login')
      return (
        <Navigate
          to="/login"
          replace
          state={{ from: location.pathname + location.search }}
        />
      );
    return (
      <LoginPage
        onLoginSuccess={(u) => {
          setUser(u);
          const from = location.state?.from;
          const safe =
            typeof from === 'string' &&
            /^\/(?:deals|clients|ingest|knowledge)(?:[/?]|$)/.test(from);
          navigate(safe ? from : '/deals', { replace: true });
        }}
      />
    );
  }

  if (location.pathname === '/login') return <Navigate to="/deals" replace />;

  const returnTo =
    typeof location.state?.returnTo === 'string' &&
    /^\/(deals|clients)(\?|$)/.test(location.state.returnTo)
      ? location.state.returnTo
      : '/clients';

  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex bg-[#F1F5F9] text-[#0F172A]">
      <Sidebar
        currentTab={tab}
        user={user}
        onLogout={() => void logout()}
        aiStatus={status}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col md:h-screen md:overflow-hidden">
        <Header
          title={titles[tab]}
          aiStatus={status}
          onOpenUpload={() => navigate('/ingest')}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-5 flex flex-col">
          {typeof location.state?.notice === 'string' && (
            <p
              role="status"
              className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium shrink-0"
            >
              {location.state.notice}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 bg-red-50 text-red-800 border border-red-200 rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-3 shrink-0"
            >
              <span>{error}</span>
              <button
                type="button"
                className="underline font-semibold shrink-0"
                onClick={refresh}
              >
                Повторить загрузку
              </button>
            </div>
          )}

          {loading && (
            <div role="status" className="py-4 text-center text-xs text-slate-500 shrink-0">
              Загрузка данных…
            </div>
          )}

          <div className={tab === 'kanban' ? 'flex-1 min-h-0 flex flex-col' : 'flex-1'}>
            <Routes>
              <Route path="/" element={<Navigate to="/deals" replace />} />
              <Route
                path="/deals"
                element={
                  <KanbanBoard
                    deals={deals}
                    counts={counts}
                    totals={totals}
                    onLoadMore={loadMore}
                    onMoveStage={async (id, stage) => {
                      try {
                        await api.updateDealStage(id, stage);
                        refresh();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                    onSelectClient={select}
                  />
                }
              />
              <Route
                path="/clients"
                element={
                  <div className="space-y-4">
                    <ClientsList
                      clients={clients}
                      initialFilters={filters}
                      onSelectClient={select}
                      onRefresh={refresh}
                      onFiltersChange={changeFilters}
                    />
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex justify-between items-center text-xs">
                      <button
                        type="button"
                        disabled={offset === 0 || loading}
                        onClick={() => changePage(page - 1)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Назад
                      </button>
                      <span className="text-slate-600 font-medium tabular-nums">
                        {clientTotal ? offset + 1 : 0}–{Math.min(offset + 50, clientTotal)} из{' '}
                        {clientTotal}
                      </span>
                      <button
                        type="button"
                        disabled={offset + 50 >= clientTotal || loading}
                        onClick={() => changePage(page + 1)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Далее
                      </button>
                    </div>
                  </div>
                }
              />
              <Route
                path="/clients/:clientId"
                element={
                  <div className="space-y-4">
                    <nav className="text-xs font-medium text-slate-500 flex items-center gap-2">
                      <Link className="text-[#0082FB] font-semibold hover:underline" to={returnTo}>
                        ← {returnTo.startsWith('/deals') ? 'К воронке' : 'Клиенты'}
                      </Link>
                      <span>/</span>
                      <span className="text-slate-900 font-semibold">
                        {selected?.name || 'Карточка клиента'}
                      </span>
                    </nav>
                    {selected && selected.id === clientId && (
                      <ClientDetailModal
                        key={selected.id}
                        asPage
                        client={selected}
                        onDeleted={(pending) => {
                          setSelected(null);
                          navigate('/clients', {
                            replace: true,
                            state: {
                              notice: pending
                                ? 'Клиент удалён. ' +
                                  pending +
                                  ' скриншотов ожидают повторной очистки и уже недоступны в CRM.'
                                : 'Клиент, сделки, переписка и скриншоты удалены.',
                            },
                          });
                        }}
                        onClose={() => navigate(returnTo)}
                        onClientUpdated={async () => {
                          const r = await api.getClient(selected.id);
                          setSelected(r.client);
                        }}
                      />
                    )}
                  </div>
                }
              />
              <Route
                path="/ingest"
                element={
                  <ScreenshotUploader
                    clients={clients}
                    onUploadSuccess={(client) =>
                      navigate('/clients/' + client.id, { state: { returnTo: '/clients' } })
                    }
                  />
                }
              />
              <Route path="/knowledge" element={<KnowledgeLibrary />} />
              <Route path="/knowledge/web" element={<WebKnowledge />} />
              <Route path="/knowledge/web/documents/:revisionId" element={<WebKnowledge />} />
              <Route path="/knowledge/documents/:documentId" element={<KnowledgeLibrary />} />
              <Route path="/knowledge/rules" element={<KnowledgeBaseView />} />
              <Route path="/knowledge/playbook" element={<SalesPlaybook />} />
              <Route
                path="*"
                element={
                  <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                    <h2 className="text-base font-bold text-slate-900">Страница не найдена</h2>
                    <Link
                      to="/deals"
                      className="inline-block text-xs font-semibold text-[#0082FB] hover:underline"
                    >
                      Перейти к воронке
                    </Link>
                  </div>
                }
              />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

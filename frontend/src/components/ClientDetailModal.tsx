import React, { useEffect, useMemo, useState } from 'react';
import { Client, AISuggestion, api } from '../api';
import { ClientPricing } from './ClientPricing';
import { ManualMessageImporter } from './ManualMessageImporter';
import {
  X,
  MessageCircle,
  Copy,
  Check,
  Phone,
  Building2,
  ExternalLink,
  MessageSquareQuote,
  Send,
  Layers,
  Trash2,
  Printer,
  Calculator,
  TrendingUp,
  Tag,
  Package,
  ArrowRight,
  Plus,
  FileText,
} from 'lucide-react';
import {mergeConversationTimeline} from '../utils/conversation-timeline';
import {
  formatCategory,
  formatConditions,
  formatMoney,
  formatPhoneDigits,
  getStatusConfig,
} from '../utils/labels';

interface ClientDetailModalProps {
  asPage?: boolean;
  client: Client;
  onClose: () => void;
  onClientUpdated: () => void;
  onDeleted: (cleanupPending: number) => void;
}

export const ClientDetailModal: React.FC<ClientDetailModalProps> = ({
  client,
  onClose,
  onClientUpdated,
  onDeleted,
  asPage = false,
}) => {
  const [activeTab, setActiveTab] = useState<'copilot' | 'timeline' | 'dossier' | 'pricing'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'pricing'
      ? 'pricing'
      : 'copilot'
  );
  const [quoteId, setQuoteId] = useState<string | undefined>();
  const [commercialEvidence, setCommercialEvidence] = useState<any>(null);

  useEffect(() => {
    setQuoteId(undefined);
    setCommercialEvidence(null);
  }, [client.id]);

  // Suggestion state
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<
    'BUSINESS' | 'FRIENDLY' | 'CLOSING' | 'EXPERT'
  >('BUSINESS');
  const [loading, setLoading] = useState(false);
  const [generatedReply, setGeneratedReply] = useState<string | null>(null);
  const [generatedSuggestionId,setGeneratedSuggestionId]=useState<string | null>(null);
  const [chatEntries,setChatEntries]=useState<AISuggestion[]>([]);
  const [chatInput,setChatInput]=useState('');
  const [chatError,setChatError]=useState('');
  const [chatLoading,setChatLoading]=useState(false);
  const [chatRefresh,setChatRefresh]=useState(0);
  const [generatedVariations,setGeneratedVariations]=useState<string[]>([]);
  const [generatedIntent,setGeneratedIntent]=useState<'REPLY'|'COMMERCIAL_OFFER'>(()=>sessionStorage.getItem('tanbox_ai_mode:'+client.id)==='COMMERCIAL_OFFER'?'COMMERCIAL_OFFER':'REPLY');
  const [pricedOffer,setPricedOffer]=useState(false);
  const [contextMessageCount,setContextMessageCount]=useState(0);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [knowledgeEvidence, setKnowledgeEvidence] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [conversations, setConversations] = useState(client.conversations || []);
  const [moreBusy, setMoreBusy] = useState(false);
  const [dealTitle, setDealTitle] = useState('');
  const [dealAmount, setDealAmount] = useState('');

  // Status updating
  const [status, setStatus] = useState(client.status);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  useEffect(() => {
    setStatus(client.status);
    setConversations(client.conversations || []);
  }, [client]);

  useEffect(()=>{
    setGeneratedReply(null);setGeneratedSuggestionId(null);setChatEntries([]);setChatInput('');setChatError('');
    setGeneratedIntent(sessionStorage.getItem('tanbox_ai_mode:'+client.id)==='COMMERCIAL_OFFER'?'COMMERCIAL_OFFER':'REPLY');
  },[client.id]);

  useEffect(()=>{
    const controller=new AbortController();
    setChatLoading(true);
    api.getDraftChat(client.id,generatedIntent,controller.signal).then(({entries})=>{
      if(controller.signal.aborted)return;
      setChatEntries(entries);
      const latest=entries[entries.length-1];
      if(latest){
        setGeneratedSuggestionId(latest.id);
        setGeneratedReply(latest.suggestedText);
        setExplanation(latest.explanation||null);
        setPricedOffer(!!latest.commercialEvidence);
        setCommercialEvidence(latest.commercialEvidence||null);
        setKnowledgeEvidence(Array.isArray(latest.knowledgeEvidence)?latest.knowledgeEvidence:[]);
      }
    }).catch(error=>{if(!controller.signal.aborted)setChatError(error instanceof Error?error.message:'Не удалось загрузить историю правок.');})
      .finally(()=>{if(!controller.signal.aborted)setChatLoading(false);});
    return ()=>controller.abort();
  },[client.id,generatedIntent,chatRefresh]);

  const rawPhone = formatPhoneDigits(client.phone);
  const statusCfg = getStatusConfig(status);
  const timelineEntries=useMemo(()=>mergeConversationTimeline(conversations),[conversations]);
  const latestMessages=timelineEntries.slice(-8).map(entry=>entry.message);
  const lastClientMessage=[...timelineEntries].reverse().find(entry=>entry.message.sender==='CLIENT')?.message.content;

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    setError('');
    try {
      await api.updateClient(client.id, { status: newStatus });
      setStatus(newStatus);
      await onClientUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить статус');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleGenerateReply = async (customPrompt?: string|null, style = selectedStyle, intent:'REPLY'|'COMMERCIAL_OFFER'='REPLY') => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.suggestReply({
        clientId: client.id,
        quoteId,
        userPrompt: customPrompt===null?undefined:customPrompt || prompt || undefined,
        provider: 'AUTO',
        style,
        intent,
      });

      if (res.suggestion) {
        setGeneratedReply(res.suggestion.reply);
        setGeneratedSuggestionId(res.suggestion.suggestionId);
        setGeneratedVariations(res.suggestion.variations||[]);
        setGeneratedIntent(intent);
        sessionStorage.setItem('tanbox_ai_mode:'+client.id,intent);
        setPricedOffer(!!res.suggestion.pricedOffer);
        setContextMessageCount(res.suggestion.context?.messageCount||0);
        setExplanation(res.suggestion.explanation);
        setCommercialEvidence(res.suggestion.commercialEvidence || null);
        setKnowledgeEvidence((res.suggestion as any).evidence || []);
        setChatRefresh(value=>value+1);
      }
    } catch (err: any) {
      setError(err.message || 'Не удалось подготовить ответ');
    } finally {
      setLoading(false);
    }
  };

  const switchDraftMode=(intent:'REPLY'|'COMMERCIAL_OFFER')=>{
    if(intent===generatedIntent)return;
    sessionStorage.setItem('tanbox_ai_mode:'+client.id,intent);
    setGeneratedIntent(intent);setGeneratedReply(null);setGeneratedSuggestionId(null);setGeneratedVariations([]);setExplanation(null);setChatEntries([]);setChatInput('');setChatError('');
  };

  const handleReviseDraft=async()=>{
    const instruction=chatInput.trim();
    if(!instruction||!generatedSuggestionId||loading)return;
    setLoading(true);setChatError('');
    try{
      const {suggestion}=await api.reviseDraft({clientId:client.id,suggestionId:generatedSuggestionId,instruction,style:selectedStyle});
      setGeneratedReply(suggestion.reply);
      setGeneratedSuggestionId(suggestion.suggestionId);
      setGeneratedVariations([]);
      setExplanation(suggestion.explanation);
      setKnowledgeEvidence((suggestion as any).evidence||[]);
      setCommercialEvidence(suggestion.commercialEvidence||null);
      setPricedOffer(!!suggestion.pricedOffer);
      setContextMessageCount(suggestion.context?.messageCount||0);
      setChatInput('');
      setChatRefresh(value=>value+1);
    }catch(error){setChatError(error instanceof Error?error.message:'Не удалось изменить черновик. Повторите запрос.');}
    finally{setLoading(false);}
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Не удалось скопировать. Выделите и скопируйте текст вручную.');
    }
  };

  const quickScenarios = [
    {
      label: 'Повторный контакт',
      icon: MessageCircle,
      style: 'FRIENDLY' as const,
      task: 'Подготовь повторный контакт: клиент не отвечает. Учти последний запрос и предложи один простой следующий шаг без давления и автоматической скидки.',
    },
    {
      label: 'Оборудование и обучение',
      icon: Printer,
      style: 'EXPERT' as const,
      task: 'Клиенту нужны оборудование и обучение для самостоятельной маркировки. Уточни не более двух недостающих параметров. Раздели принтер, настройку, обучение, расходные материалы и интеграцию. Цену и модель не придумывай.',
    },
    {
      label: 'Подготовить расчёт',
      icon: Calculator,
      style: undefined,
      task: 'Подготовь следующий шаг для расчёта стоимости. Используй известные сведения и запроси не более двух недостающих параметров партии. Без серверного расчёта не называй цену; реквизиты для счёта запрашивай после согласования предложения.',
    },
    {
      label: 'Обсудить стоимость',
      icon: TrendingUp,
      style: 'CLOSING' as const,
      task: 'Обоснуй стоимость через подтверждённый состав работ и преимущества сервиса. Уточни, что требует пояснения. Не назначай скидку и не используй юридические угрозы.',
    },
    {
      label: 'Подобрать этикетку',
      icon: Tag,
      style: 'EXPERT' as const,
      task: 'Помоги подобрать этикетку под товар и условия хранения. Учитывай уже известные параметры, уточни недостающие. Не обещай универсальный размер, срок службы или стойкость без подтверждённых характеристик.',
    },
    {
      label: 'Решение под Kaspi Магазин',
      icon: Package,
      style: undefined,
      task: 'Уточни, продает ли клиент через Kaspi / маркетплейсы или через опт, и предложи готовое решение под ключ.',
    },
  ];

  const tabs: { id: 'copilot' | 'timeline' | 'pricing' | 'dossier'; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'copilot', label: 'Подсказка ответа', icon: MessageSquareQuote },
    { id: 'timeline', label: 'Переписка', icon: MessageCircle },
    { id: 'pricing', label: 'Расчёт стоимости', icon: Calculator },
    { id: 'dossier', label: 'Реквизиты и статус', icon: Layers },
  ];

  const showConversationPreview = activeTab === 'copilot' || activeTab === 'pricing';

  return (
    <div
      className={
        asPage
          ? 'w-full space-y-4'
          : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50'
      }
    >
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-client-title"
            className="bg-white border border-slate-200 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-xl"
          >
            <h2 id="delete-client-title" className="font-bold text-base text-slate-900">
              Удалить клиента полностью?
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Будут удалены «{client.name}», все его сделки, переписка, AI-подсказки и
              скриншоты. Отменить это действие в CRM нельзя.
            </p>
            {deleteError && (
              <p role="alert" className="text-red-700 text-xs font-medium bg-red-50 border border-red-200 rounded-lg p-2.5">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="border border-slate-200 rounded-lg px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={deleting}
                className="bg-red-700 hover:bg-red-800 text-white rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
                onClick={async () => {
                  if (deleting) return;
                  setDeleting(true);
                  setDeleteError('');
                  try {
                    const result = await api.deleteClient(client.id);
                    onDeleted(result.cleanupPending);
                  } catch (e) {
                    setDeleteError(
                      e instanceof Error ? e.message : 'Не удалось удалить клиента'
                    );
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Удаление…' : 'Удалить полностью'}
              </button>
            </div>
          </section>
        </div>
      )}

      <div
        className={
          asPage
            ? 'space-y-4 w-full'
            : 'bg-white border border-slate-200 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden'
        }
      >
        {/* Client Header Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 truncate">{client.name}</h2>
              {client.category && (
                <span className="text-[11px] px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                  {formatCategory(client.category)}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded font-semibold border ${statusCfg.badgeClass}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotClass}`} />
                {statusCfg.label}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
              {client.company && (
                <span className="inline-flex items-center gap-1.5 text-slate-800 font-medium">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    {client.company}
                    {client.binIin ? ` · БИН ${client.binIin}` : ''}
                  </span>
                </span>
              )}
              {client.phone && (
                <a
                  href={rawPhone ? `https://wa.me/${rawPhone}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[#0082FB] font-semibold hover:underline tabular-nums"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{client.phone}</span>
                </a>
              )}
              {client.estimatedVolume && (
                <span className="tabular-nums">
                  Объём из карточки:{' '}
                  <strong className="text-slate-900">
                    {client.estimatedVolume.toLocaleString('ru-RU')}
                  </strong>{' '}
                  шт/пар
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <select
              aria-label="Статус клиента"
              value={status}
              disabled={updatingStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-xs text-slate-900 rounded-lg px-3 py-2 font-semibold focus:outline-none focus:border-[#0082FB]"
            >
              <option value="LEAD">Новый лид</option>
              <option value="IN_NEGOTIATION">В переговорах</option>
              <option value="KP_SENT">КП отправлено</option>
              <option value="PAYMENT_PENDING">Счет на оплате</option>
              <option value="IN_PROGRESS">В работе</option>
              <option value="WON">Оплачено / В работе</option>
              <option value="LOST">Отказ</option>
            </select>

            <button
              type="button"
              disabled={loading || updatingStatus || moreBusy || deleting}
              onClick={() => {
                setDeleteError('');
                setConfirmDelete(true);
              }}
              className="text-xs font-semibold text-red-700 border border-red-200 bg-white hover:bg-red-50 px-3 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Удалить клиента</span>
            </button>

            {!asPage && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white border border-slate-200 rounded-xl px-2 flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (tab.id === 'pricing') setQuoteId(undefined);
                  setActiveTab(tab.id);
                }}
                className={`inline-flex items-center gap-2 py-3 px-4 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'border-[#0082FB] text-[#0082FB]'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <p
            role="alert"
            className="text-red-800 bg-red-50 border border-red-200 p-3.5 rounded-xl text-xs font-medium"
          >
            {error}
          </p>
        )}

        {/* 2-Column Workspace */}
        <div
          className={
            asPage
              ? 'grid grid-cols-1 xl:grid-cols-12 gap-5 items-start'
              : 'p-5 overflow-y-auto flex-1 space-y-5'
          }
        >
          {/* Main Column */}
          <div className={asPage ? 'xl:col-span-8 space-y-4' : 'space-y-4'}>
            {activeTab === 'pricing' && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5">
                <ClientPricing
                  clientId={client.id}
                  onSelect={(id) => {
                    setQuoteId(id);
                    setActiveTab('copilot');
                    setPrompt(
                      'Объясни клиенту подготовленный серверный расчёт: состав работ, итоговую стоимость и исключения. Не пересчитывай сумму и предложи следующий шаг.'
                    );
                  }}
                />
              </div>
            )}

            {/* TAB 1: COPILOT */}
            {activeTab === 'copilot' && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5 space-y-5">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                  <strong className="text-slate-900">База TANBOX подключена:</strong> ответ
                  учитывает подтверждённые коммерческие правила и проверенные сведения по
                  Казахстану. Основания и условия показаны рядом с ответом; при нехватке
                  данных CRM предложит уточнение.
                </div>

                {lastClientMessage && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-slate-800">
                    <strong className="block text-slate-900 mb-1">Последнее сообщение клиента · контекст для ответа</strong>
                    <p className="max-h-28 overflow-y-auto whitespace-pre-wrap leading-relaxed">{lastClientMessage}</p>
                  </div>
                )}

                {quoteId && (
                  <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 px-3.5 py-2.5 rounded-lg flex items-center justify-between gap-2">
                    <span>Для ответа выбран сохранённый расчёт.</span>
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => {
                        setQuoteId(undefined);
                        setActiveTab('pricing');
                      }}
                    >
                      Изменить расчёт
                    </button>
                  </div>
                )}

                {commercialEvidence && (
                  <div className="text-xs bg-blue-50 border border-blue-200 text-slate-800 px-3.5 py-2.5 rounded-lg flex items-center justify-between gap-2">
                    <span>
                      Основание стоимости: расчёт на{' '}
                      <strong>
                        {commercialEvidence.calculation.input.itemsCount.toLocaleString('ru-RU')}
                      </strong>{' '}
                      ед.,{' '}
                      <strong>
                        {commercialEvidence.calculation.total.toLocaleString('ru-RU')} ₸
                      </strong>
                      .
                    </span>
                    <button
                      type="button"
                      className="text-[#0082FB] font-semibold underline shrink-0"
                      onClick={() => setActiveTab('pricing')}
                    >
                      История расчётов
                    </button>
                  </div>
                )}

                {/* Quick Scenarios */}
                <div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button type="button" disabled={loading} onClick={()=>void handleGenerateReply(null,selectedStyle,'REPLY')} className="inline-flex items-center gap-2 rounded-lg bg-[#0082FB] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><MessageCircle className="h-4 w-4" /> Ответить на последнее сообщение</button>
                    <button type="button" disabled={loading} onClick={()=>void handleGenerateReply('Подготовь коммерческое предложение по истории клиента и актуальному прайсу TANBOX.',selectedStyle,'COMMERCIAL_OFFER')} className="inline-flex items-center gap-2 rounded-lg border border-[#0082FB] bg-white px-4 py-2.5 text-xs font-semibold text-[#0082FB] disabled:opacity-50"><FileText className="h-4 w-4" /> Составить КП</button>
                  </div>
                  <span className="text-[11px] font-bold uppercase text-slate-500 tracking-wider block mb-2">
                    Быстрые сценарии для WhatsApp
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {quickScenarios.map((sc) => {
                      const Icon = sc.icon;
                      return (
                        <button
                          key={sc.label}
                          type="button"
                          onClick={() => {
                            if (sc.style) setSelectedStyle(sc.style);
                            setPrompt(sc.task);
                            void handleGenerateReply(sc.task, sc.style || selectedStyle);
                          }}
                          className="flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-[#0082FB] text-slate-800 font-semibold transition-colors"
                        >
                          <Icon className="w-3.5 h-3.5 text-[#0082FB] shrink-0" />
                          <span className="truncate">{sc.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Style Selector */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                    Стиль ответа
                  </label>
                  <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs font-semibold flex-wrap">
                    {(
                      [
                        ['BUSINESS', 'Деловой'],
                        ['CLOSING', 'Следующий шаг'],
                        ['FRIENDLY', 'Теплый'],
                        ['EXPERT', 'Эксперт'],
                      ] as const
                    ).map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setSelectedStyle(code)}
                        className={`px-3.5 py-1.5 rounded-md transition-colors ${
                          selectedStyle === code
                            ? 'bg-[#0082FB] text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Prompt */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 block">
                    Новая задача для ИИ
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Например: Уточни состав партии или подготовь короткое сообщение после КП…"
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
                    />
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleGenerateReply()}
                      className="px-5 py-2.5 bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors inline-flex items-center justify-center gap-2 shrink-0"
                    >
                      {loading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Подготовка…</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          <span>Сформировать ответ</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Generated Result */}
                {generatedReply && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                        <MessageCircle className="w-4 h-4" />
                        <span>{generatedIntent==='COMMERCIAL_OFFER'?'Черновик коммерческого предложения':'Готовое сообщение для отправки в WhatsApp'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(generatedReply)}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                          copied
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-[#0082FB] hover:text-[#0082FB]'
                        }`}
                      >
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
                      </button>
                    </div>

                    <div className="p-3.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-900 whitespace-pre-wrap leading-relaxed">
                      {generatedReply}
                    </div>

                    {generatedIntent==='COMMERCIAL_OFFER'&&!pricedOffer&&(
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Итоговая сумма не рассчитана: для неё нужны точный объём партии и состав работ. Опубликованные ставки TANBOX указаны в КП, если прайс доступен. <button type="button" onClick={()=>setActiveTab('pricing')} className="font-semibold underline">Уточнить расчёт</button></div>
                    )}

                    {generatedIntent==='REPLY'&&generatedVariations.length>0&&(
                      <div className="space-y-2"><strong className="text-xs text-slate-800">Другие варианты ответа</strong>{generatedVariations.map((variant,index)=><div key={index} className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900"><p className="whitespace-pre-wrap leading-relaxed">{variant}</p><button type="button" onClick={()=>void copyToClipboard(variant)} className="mt-2 inline-flex items-center gap-1 text-[#0082FB] font-semibold"><Copy className="h-3.5 w-3.5" /> Копировать вариант {index+1}</button></div>)}</div>
                    )}

                    {contextMessageCount>0&&<p className="text-[11px] text-slate-500">Учтено сообщений в истории: {contextMessageCount}. Ответ и КП проверьте перед отправкой клиенту.</p>}

                    {explanation && (
                      <div className="text-xs text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                        <strong className="text-slate-900">Логика ответа:</strong> {explanation}
                      </div>
                    )}

                    {knowledgeEvidence.length > 0 && (
                      <details className="bg-white border border-slate-200 rounded-lg p-3 text-xs">
                        <summary className="cursor-pointer font-semibold text-slate-800">
                          Основания ответа: {knowledgeEvidence.length} проверенных правил
                        </summary>
                        <ul className="space-y-3 mt-3 border-t border-slate-100 pt-3">
                          {knowledgeEvidence.map((fact: any) => {
                            const conditions = formatConditions(fact.conditions);
                            return (
                              <li key={fact.factId} className="space-y-1.5">
                                <strong className="text-slate-900 block">{fact.title}</strong>
                                {conditions.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {conditions.map((c, idx) => (
                                      <span
                                        key={idx}
                                        className="text-[11px] bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded"
                                      >
                                        <span className="text-slate-500">{c.key}:</span> {c.value}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="space-y-1">
                                  {fact.sources.map((source: any) => (
                                    <p key={source.revisionId} className="text-[11px] text-slate-600">
                                      <a
                                        className="text-[#0082FB] font-medium hover:underline"
                                        href={'/knowledge/web/documents/' + source.revisionId}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {source.title}
                                      </a>{' '}
                                      · {source.locator}
                                    </p>
                                  ))}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}

                    {rawPhone && (
                      <div className="flex justify-end">
                        <a
                          href={`https://web.whatsapp.com/send?phone=${rawPhone}&text=${encodeURIComponent(
                            generatedReply
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Открыть WhatsApp Web с этим текстом</span>
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <section aria-label="Чат с ИИ для правки черновика" className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Чат с ИИ · правки {generatedIntent==='COMMERCIAL_OFFER'?'КП':'ответа'}</h3>
                    <p className="mt-1 text-xs text-slate-600">Напишите, что изменить в текущем черновике. ИИ учтёт предыдущие замечания и историю клиента. Правки сохраняются в карточке.</p>
                  </div>
                  <div className="inline-flex rounded-lg border border-blue-200 bg-white p-0.5 text-xs font-semibold">
                    <button type="button" onClick={()=>switchDraftMode('REPLY')} className={`rounded-md px-3 py-1.5 ${generatedIntent==='REPLY'?'bg-[#0082FB] text-white':'text-slate-600 hover:bg-slate-50'}`}>Ответы</button>
                    <button type="button" onClick={()=>switchDraftMode('COMMERCIAL_OFFER')} className={`rounded-md px-3 py-1.5 ${generatedIntent==='COMMERCIAL_OFFER'?'bg-[#0082FB] text-white':'text-slate-600 hover:bg-slate-50'}`}>КП</button>
                  </div>
                  {chatLoading&&<p className="text-xs text-slate-500">Загружаю историю правок…</p>}
                  {chatEntries.length>0&&(
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                      {chatEntries.map((entry,index)=><div key={entry.id} className="space-y-1.5">
                        {entry.query&&<div className="ml-auto max-w-[90%] rounded-xl rounded-tr-sm bg-[#0082FB] px-3 py-2 text-xs text-white whitespace-pre-wrap"><span className="block text-[10px] font-bold text-blue-100 mb-1">Вы</span>{entry.query}</div>}
                        <details className="max-w-[95%] rounded-xl rounded-tl-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900">
                          <summary className="cursor-pointer font-semibold">ИИ · версия {index+1} · {new Date(entry.createdAt).toLocaleString('ru-RU')}</summary>
                          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{entry.suggestedText}</p>
                        </details>
                      </div>)}
                    </div>
                  )}
                  {!generatedSuggestionId&&!chatLoading&&<p className="text-xs text-slate-600">Сначала нажмите «Ответить на последнее сообщение» или «Составить КП», затем отправляйте правки сюда.</p>}
                  {chatError&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">{chatError}</p>}
                  <form onSubmit={event=>{event.preventDefault();void handleReviseDraft();}} className="space-y-2">
                    <textarea value={chatInput} onChange={event=>setChatInput(event.target.value)} maxLength={3000} rows={3}
                      onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void handleReviseDraft();}}}
                      placeholder={generatedIntent==='COMMERCIAL_OFFER'?'Например: сократи КП до одного экрана, сохрани цену и условия. Убери обещание по срокам.':'Например: не начинай с приветствия, ответь на последний вопрос клиента и сделай текст короче.'}
                      className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 focus:border-[#0082FB] focus:outline-none" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">Ctrl+Enter — отправить правку</span>
                      <button type="submit" disabled={!chatInput.trim()||!generatedSuggestionId||chatLoading||loading} className="inline-flex items-center gap-2 rounded-lg bg-[#0082FB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" />{loading?'Исправляю…':'Исправить черновик'}</button>
                    </div>
                  </form>
                </section>
              </div>
            )}

            {/* TAB 2: TIMELINE */}
            {activeTab === 'timeline' && (
              <div className="space-y-4">
                <details className="rounded-xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer text-xs font-semibold text-[#0082FB]">+ Добавить сообщения вручную</summary>
                  <div className="mt-3"><ManualMessageImporter clientId={client.id} onSaved={(chunk)=>{
                    setConversations(previous=>[chunk,...previous.filter(item=>item.id!==chunk.id)]);
                    setGeneratedReply(null);setGeneratedVariations([]);setExplanation(null);
                    onClientUpdated();
                  }} /></div>
                </details>
                {timelineEntries.length>0&&(
                  <section aria-label="Последовательность переписки" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="border-b border-slate-100 pb-3"><h3 className="text-sm font-bold text-slate-900">История общения · {timelineEntries.length} сообщ.</h3><p className="mt-1 text-[11px] text-slate-500">Сообщения показаны в порядке переписки. Повторяющиеся фрагменты скриншотов объединены; исходные загрузки доступны ниже.</p></div>
                    <div className="max-h-[650px] space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3">
                      {timelineEntries.map(({message,source})=>{
                        const manager=message.sender==='MANAGER';
                        return <div key={message.id} className={`flex flex-col ${manager?'items-end':'items-start'}`}>
                          <span className="mb-1 px-1 text-[10px] font-semibold text-slate-500">{manager?'Менеджер Tanbox':message.senderName||client.name}{(message.timestamp||message.originalTime)&&<span className="ml-2 font-normal tabular-nums">{message.timestamp?new Date(message.timestamp).toLocaleString('ru-RU'):message.originalTime}</span>}{source==='MANUAL_ENTRY'&&<span className="ml-2 font-normal">· вручную</span>}</span>
                          <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2 text-xs leading-relaxed ${manager?'rounded-tr-none bg-[#0082FB] text-white':'rounded-tl-none border border-slate-200 bg-white text-slate-900'}`}>{message.content}</div>
                        </div>;
                      })}
                    </div>
                  </section>
                )}
                {conversations.length === 0 ? (
                  <div className="py-14 text-center text-slate-400 bg-white rounded-xl border border-slate-200 text-xs">
                    Диалогов пока нет. Добавьте сообщения выше или загрузите скриншоты через раздел «Загрузка переписок».
                  </div>
                ) : (
                  <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
                    <summary className="cursor-pointer font-semibold text-slate-700">Исходные загрузки и скриншоты ({conversations.length})</summary>
                    <div className="mt-3 space-y-3">
                  {conversations.map((chunk) => {
                    const screenshots = (chunk.screenshotUrl || '')
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);

                    return (
                      <div
                        key={chunk.id}
                        className="p-4 rounded-xl bg-white border border-slate-200 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-b border-slate-100 pb-2.5">
                          <span className="font-bold text-slate-900">
                            {chunk.summary || 'Фрагмент переписки WhatsApp'}
                          </span>
                          <span className="text-[11px] tabular-nums">
                            Добавлено: {new Date(chunk.createdAt).toLocaleString('ru-RU')}
                          </span>
                        </div>

                        {screenshots.length > 0 && (
                          <div>
                            <span className="text-[11px] text-slate-500 font-semibold block mb-1.5">
                              Скриншоты ({screenshots.length})
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {screenshots.map((url, sIdx) => (
                                <a
                                  key={sIdx}
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block relative group"
                                >
                                  <img
                                    src={url}
                                    alt={`Скриншот ${sIdx + 1}`}
                                    className="h-28 rounded-lg border border-slate-200 group-hover:border-[#0082FB] transition-colors object-cover"
                                  />
                                  <span className="absolute bottom-1 right-1 bg-slate-900/75 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                                    #{sIdx + 1}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {chunk.messages.length < (chunk._count?.messages || 0) && (
                          <button
                            type="button"
                            disabled={moreBusy}
                            className="text-xs font-semibold text-[#0082FB] hover:underline"
                            onClick={async () => {
                              setMoreBusy(true);
                              try {
                                const r = await api.getMessages(chunk.id, chunk.messages.length);
                                setConversations((prev) =>
                                  prev.map((c) =>
                                    c.id === chunk.id
                                      ? { ...c, messages: [...r.messages, ...c.messages] }
                                      : c
                                  )
                                );
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : 'Не удалось загрузить сообщения'
                                );
                              } finally {
                                setMoreBusy(false);
                              }
                            }}
                          >
                            Загрузить предыдущие сообщения
                          </button>
                        )}

                        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1 bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                          {chunk.messages.map((m) => {
                            const isManager = m.sender === 'MANAGER';
                            return (
                              <div
                                key={m.id}
                                className={`flex flex-col ${isManager ? 'items-end' : 'items-start'}`}
                              >
                                <span className="text-[10px] text-slate-500 px-1 mb-0.5 font-semibold">
                                  {isManager ? 'Менеджер Tanbox' : m.senderName || client.name}
                                  {(m.originalTime || m.timestamp) && (
                                    <span className="font-normal ml-2 tabular-nums">
                                      {m.timestamp
                                        ? new Date(m.timestamp).toLocaleString('ru-RU')
                                        : m.originalTime}
                                    </span>
                                  )}
                                </span>
                                <div
                                  className={`max-w-[82%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                                    isManager
                                      ? 'bg-[#0082FB] text-white rounded-tr-none'
                                      : 'bg-white text-slate-900 rounded-tl-none border border-slate-200'
                                  }`}
                                >
                                  {m.content}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                    </div>
                  </details>
                )}

                {conversations.length < (client._count?.conversations || 0) && (
                  <button
                    type="button"
                    disabled={moreBusy}
                    className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0082FB] hover:border-[#0082FB]"
                    onClick={async () => {
                      setMoreBusy(true);
                      try {
                        const r = await api.getConversations(client.id, conversations.length);
                        setConversations((prev) => [...prev, ...r.conversations]);
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : 'Не удалось загрузить историю'
                        );
                      } finally {
                        setMoreBusy(false);
                      }
                    }}
                  >
                    Загрузить предыдущую переписку
                  </button>
                )}
              </div>
            )}

            {/* TAB 4: DOSSIER & DEALS */}
            {activeTab === 'dossier' && (
              <div className="space-y-4">
                <form
                  className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (moreBusy) return;
                    setMoreBusy(true);
                    setError('');
                    try {
                      await api.createDeal({
                        clientId: client.id,
                        title: dealTitle,
                        amount: dealAmount ? Number(dealAmount) : undefined,
                      });
                      setDealTitle('');
                      setDealAmount('');
                      await onClientUpdated();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : 'Не удалось создать сделку'
                      );
                    } finally {
                      setMoreBusy(false);
                    }
                  }}
                >
                  <div className="flex-1 min-w-[200px] space-y-1">
                    <label className="text-[11px] font-semibold text-slate-600 block">
                      Название новой сделки
                    </label>
                    <input
                      required
                      maxLength={300}
                      aria-label="Название новой сделки"
                      placeholder="Например: Маркировка обуви — 5 000 пар"
                      value={dealTitle}
                      onChange={(e) => setDealTitle(e.target.value)}
                      className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
                    />
                  </div>
                  <div className="w-full sm:w-44 space-y-1">
                    <label className="text-[11px] font-semibold text-slate-600 block">
                      Сумма, ₸
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label="Сумма новой сделки"
                      placeholder="0"
                      value={dealAmount}
                      onChange={(e) => setDealAmount(e.target.value)}
                      className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={moreBusy}
                    className="inline-flex items-center gap-1.5 bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Создать новую сделку</span>
                  </button>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Реквизиты и объем
                    </h4>
                    <div className="text-xs text-slate-700 space-y-1.5">
                      <p>
                        <span className="text-slate-500">Компания:</span>{' '}
                        <strong>{client.company || '—'}</strong>
                      </p>
                      <p>
                        <span className="text-slate-500">БИН/ИИН:</span>{' '}
                        <strong className="tabular-nums">{client.binIin || '—'}</strong>
                      </p>
                      <p>
                        <span className="text-slate-500">Категория:</span>{' '}
                        <strong>{formatCategory(client.category)}</strong>
                      </p>
                      <p>
                        <span className="text-slate-500">Объем:</span>{' '}
                        <strong className="tabular-nums">
                          {client.estimatedVolume
                            ? `${client.estimatedVolume.toLocaleString('ru-RU')} шт/пар`
                            : '—'}
                        </strong>
                      </p>
                      <p>
                        <span className="text-slate-500">Оценка суммы:</span>{' '}
                        <strong className="tabular-nums">
                          {formatMoney(client.estimatedAmount)}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Сделки клиента ({client.deals?.length || 0})
                    </h4>
                    {!client.deals || client.deals.length === 0 ? (
                      <p className="text-xs text-slate-400">Сделки ещё не созданы</p>
                    ) : (
                      <ul className="space-y-2">
                        {client.deals.map((d) => (
                          <li
                            key={d.id}
                            className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 truncate">{d.title}</p>
                              <p className="text-[11px] text-slate-500">{d.stage}</p>
                            </div>
                            <span className="font-semibold text-[#0082FB] tabular-nums shrink-0">
                              {formatMoney(d.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {client.notes && (
                  <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-1.5">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Заметки
                    </h4>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {client.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Context Panel (visible alongside main column on xl+ when asPage=true) */}
          {asPage && (
            <aside className="xl:col-span-4 space-y-4">
              {/* AI Summary & Next Step */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Сводка по клиенту
                </h3>

                <div className="space-y-2.5 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
                    <span className="text-[11px] font-semibold text-slate-500 block">
                      Выжимка ситуации
                    </span>
                    <p className="text-slate-800 leading-relaxed">
                      {client.aiSummary || 'Анализ формируется…'}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200/80 space-y-1">
                    <span className="text-[11px] font-semibold text-[#0082FB] block">
                      Рекомендуемый следующий шаг
                    </span>
                    <p className="text-slate-900 font-semibold leading-relaxed">
                      {client.aiNextStep || 'Уточнить параметры заказа'}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200/80 space-y-1">
                    <span className="text-[11px] font-semibold text-amber-800 block">
                      Возражения клиента
                    </span>
                    <p className="text-slate-800 leading-relaxed">
                      {client.aiObjections || 'Явных возражений не зафиксировано'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Contextual Second Card */}
              {showConversationPreview ? (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Последняя переписка
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('timeline')}
                      className="text-[11px] font-semibold text-[#0082FB] hover:underline inline-flex items-center gap-1"
                    >
                      <span>Вся история</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {latestMessages.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center bg-slate-50 rounded-lg border border-slate-200/70">
                      Сообщений пока нет
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {latestMessages.map((m) => {
                        const isManager = m.sender === 'MANAGER';
                        return (
                          <div
                            key={m.id}
                            className={`flex flex-col ${isManager ? 'items-end' : 'items-start'}`}
                          >
                            <span className="text-[10px] text-slate-400 px-1 mb-0.5">
                              {isManager ? 'Менеджер' : m.senderName || client.name}
                            </span>
                            <div
                              className={`max-w-[90%] rounded-lg px-3 py-1.5 text-xs leading-snug ${
                                isManager
                                  ? 'bg-[#0082FB] text-white'
                                  : 'bg-slate-100 text-slate-900 border border-slate-200'
                              }`}
                            >
                              {m.content}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Быстрые переходы
                  </h3>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('copilot')}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 hover:border-[#0082FB] text-xs font-semibold text-slate-800 transition-colors"
                    >
                      <span>Подготовить ответ в WhatsApp</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#0082FB]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuoteId(undefined);
                        setActiveTab('pricing');
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 hover:border-[#0082FB] text-xs font-semibold text-slate-800 transition-colors"
                    >
                      <span>Перейти к расчёту стоимости</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#0082FB]" />
                    </button>
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};

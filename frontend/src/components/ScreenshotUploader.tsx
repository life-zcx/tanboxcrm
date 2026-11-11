import React, { useEffect, useState } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  ArrowRight,
  X,
  Image as ImageIcon,
  ArrowLeft,
} from 'lucide-react';
import { api, Client } from '../api';

interface ScreenshotUploaderProps {
  clients: Client[];
  onUploadSuccess: (newClient: Client) => void;
}

type ReviewedMessage = {sender:'CLIENT'|'MANAGER'; senderName?:string; content:string; time?:string};
type ReviewedConversation = {
  clientName:string; phone?:string; companyName?:string; category:string;
  summary:string; nextStep:string; messages:ReviewedMessage[];
  [key:string]:unknown;
};

export const ScreenshotUploader: React.FC<ScreenshotUploaderProps> = ({
  clients,
  onUploadSuccess,
}) => {
  const [mode, setMode] = useState<'screenshot' | 'text'>('screenshot');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [rawText, setRawText] = useState('');
  const [targetClientId, setTargetClientId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [review, setReview] = useState<{parsed:ReviewedConversation;reviewToken:string}|null>(null);
  const [error, setError] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [matchingClients, setMatchingClients] = useState(clients);

  useEffect(() => {
    const urls = selectedFiles.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [selectedFiles]);

  useEffect(() => { setReview(null); }, [selectedFiles, targetClientId]);

  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api
        .getClients({ search: clientSearch, limit: 50 }, abort.signal)
        .then((r) => setMatchingClients(r.clients))
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [clientSearch]);

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArr = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      addFiles(filesArr);
    }
  };

  const addFiles = (newFiles: File[]) => {
    if (loading) return;
    const updated = [...selectedFiles, ...newFiles];
    if (
      updated.length > 15 ||
      updated.some((f) => f.size > 10 * 1024 * 1024) ||
      updated.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024 ||
      updated.some((f) => !['image/png', 'image/jpeg', 'image/webp'].includes(f.type))
    ) {
      setError('Допускается до 15 PNG/JPG/WEBP: до 10 МБ каждый и до 40 МБ суммарно');
      return;
    }
    setError('');
    setSelectedFiles(updated);
    setResult(null);
  };

  const removeFile = (idx: number) => {
    if (loading) return;
    setSelectedFiles(selectedFiles.filter((_, i) => i !== idx));
  };

  const moveFile = (index: number, direction: number) => {
    if (loading) return;
    setSelectedFiles((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const updateReview = (change:Partial<ReviewedConversation>) =>
    setReview(previous => previous ? {...previous,parsed:{...previous.parsed,...change}} : previous);
  const updateMessage = (index:number,change:Partial<ReviewedMessage>) =>
    setReview(previous => previous ? {...previous,parsed:{...previous.parsed,messages:previous.parsed.messages.map((message,i)=>i===index?{...message,...change}:message)}} : previous);
  const moveMessage = (index:number,direction:number) =>
    setReview(previous => {
      if (!previous) return previous;
      const target=index+direction;
      if (target<0 || target>=previous.parsed.messages.length) return previous;
      const messages=[...previous.parsed.messages];
      [messages[index],messages[target]]=[messages[target],messages[index]];
      return {...previous,parsed:{...previous.parsed,messages}};
    });

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      if (mode === 'screenshot' && selectedFiles.length > 0) {
        const res = review
          ? await api.commitScreenshots(selectedFiles, review.reviewToken, review.parsed, targetClientId || undefined)
          : await api.previewScreenshots(selectedFiles, targetClientId || undefined);
        if (review || res.duplicate) {
          const saved = res.result;
          setResult(saved);
          if (saved?.client) { onUploadSuccess(saved.client); setSelectedFiles([]); setReview(null); }
        } else setReview({parsed:res.parsed,reviewToken:res.reviewToken});
      } else if (mode === 'text' && rawText.trim()) {
        const res = await api.ingestText(rawText, targetClientId || undefined);
        setResult(res.result);
        if (res.result?.client) {
          onUploadSuccess(res.result.client);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Не удалось обработать переписку. Повторите запрос.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-medium"
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Source & Input */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <UploadCloud className="w-4 h-4 text-[#0082FB]" />
                  <span>Загрузка переписок из WhatsApp</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Загрузите до 15 скриншотов одной беседы от старых к новым или вставьте текст.
                </p>
              </div>

              {/* Mode Switcher */}
              <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMode('screenshot')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    mode === 'screenshot'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Скриншоты ({selectedFiles.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('text')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                    mode === 'text'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Текст переписки</span>
                </button>
              </div>
            </div>

            {/* Client Binding */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5">
              <div>
                <span className="text-xs font-semibold text-slate-900 block">
                  Привязка к клиенту
                </span>
                <span className="text-[11px] text-slate-500">
                  По умолчанию система определит клиента по номеру/БИН или создаст новую карточку.
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  aria-label="Найти клиента для привязки"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Поиск клиента по имени / телефону"
                  className="border border-slate-200 bg-white rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0082FB]"
                />
                <select
                  aria-label="Целевой клиент"
                  value={targetClientId}
                  onChange={(e) => setTargetClientId(e.target.value)}
                  className="bg-white border border-slate-200 text-xs font-semibold text-slate-800 rounded-lg px-3 py-2 focus:outline-none focus:border-[#0082FB]"
                >
                  <option value="">Автоопределение / Новый клиент</option>
                  {matchingClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Input Zone */}
            {mode === 'screenshot' ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-slate-300 hover:border-[#0082FB] bg-slate-50/70 rounded-xl p-8 text-center transition-colors flex flex-col items-center justify-center min-h-[240px]"
              >
                <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 text-[#0082FB] flex items-center justify-center mb-3">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-slate-900 text-xs">
                  Перетащите один или несколько скриншотов сюда
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">
                  PNG, JPG, WEBP: до 10 МБ каждый, до 40 МБ суммарно, до 15 файлов.
                </p>
                <label className="inline-block mt-4 px-4 py-2 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold cursor-pointer transition-colors">
                  Выбрать файлы на компьютере
                  <input
                    type="file"
                    multiple
                    disabled={loading}
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFilesChange}
                    className="hidden"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-800 block">
                  Текст переписки WhatsApp
                </label>
                <p className="text-[11px] text-slate-500">Если есть исходный чат, в WhatsApp выберите «Экспорт чата» → «Без медиа» и загрузите полученный TXT. В нём имена и время доступны без распознавания изображения.</p>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <FileText className="h-4 w-4" /> Загрузить экспорт .txt
                  <input type="file" accept=".txt,text/plain" className="hidden" disabled={loading} onChange={async e=>{
                    const file=e.target.files?.[0];if(!file)return;
                    try {
                      if(file.size>200000)throw new Error('TXT слишком большой: загрузите часть переписки до 50 000 символов.');
                      const content=await file.text();
                      if(!content.trim() || content.length>50000)throw new Error('Текст должен содержать от 1 до 50 000 символов.');
                      setRawText(content);setError('');setResult(null);
                    }catch(error){setError(error instanceof Error?error.message:'Не удалось прочитать TXT.');}
                    e.target.value='';
                  }} />
                </label>
                <textarea
                  rows={11}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="[14:20] Клиент: Салам! Нужна маркировка на 2000 пар обуви, сколько стоит?&#10;[14:22] Менеджер: Добрый день! Подскажите категорию товара и состав партии..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs font-mono text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
                />
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <button
                type="button"
                disabled={
                  loading ||
                  (mode === 'screenshot' && (selectedFiles.length === 0 || !!review && (!review.parsed.clientName.trim() || !review.parsed.summary.trim() || !review.parsed.nextStep.trim() || review.parsed.messages.some(message=>!message.content.trim())))) ||
                  (mode === 'text' && !rawText.trim())
                }
                onClick={handleSubmit}
                className="w-full sm:w-auto px-6 py-2.5 bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors inline-flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Обработка переписки…</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    <span>{mode === 'screenshot' ? review ? 'Подтвердить и сохранить переписку' : `Распознать и проверить (${selectedFiles.length} скрин.)` : 'Внести переписку в CRM'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Order Queue / Guide / Result */}
        <div className="lg:col-span-6 space-y-4">
          {mode === 'screenshot' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Порядок скриншотов ({selectedFiles.length}/15)
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Расположите изображения от старых сообщений к новым — система удаляет перекрытия.
                  </p>
                </div>
                {selectedFiles.length > 0 && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setSelectedFiles([]);
                      setPreviewUrls([]);
                    }}
                    className="text-xs font-semibold text-red-700 hover:underline"
                  >
                    Очистить все
                  </button>
                )}
              </div>

              {selectedFiles.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-400 bg-slate-50 border border-slate-200/80 rounded-lg">
                  Скриншоты ещё не выбраны. Добавьте файлы слева, чтобы проверить и поправить их порядок.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {previewUrls.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative rounded-lg overflow-hidden border border-slate-200 bg-white flex flex-col"
                    >
                      <div className="relative bg-slate-100">
                        <a href={url} target="_blank" rel="noopener noreferrer" title="Открыть скриншот полностью">
                          <img src={url} alt={`Скриншот ${idx + 1}`} className="h-36 w-full object-cover" />
                        </a>
                        <span className="absolute top-1.5 left-1.5 bg-slate-900/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => removeFile(idx)}
                          className="absolute top-1.5 right-1.5 p-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                          title="Удалить"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="p-2 space-y-2 border-t border-slate-100">
                        <p
                          className="truncate text-[11px] font-medium text-slate-700"
                          title={selectedFiles[idx]?.name}
                        >
                          {selectedFiles[idx]?.name}
                        </p>
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            disabled={loading || idx === 0}
                            aria-label={'Переместить скриншот ' + (idx + 1) + ' раньше'}
                            onClick={() => moveFile(idx, -1)}
                            className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-medium border border-slate-200 rounded py-1 hover:bg-slate-50 disabled:opacity-35"
                          >
                            <ArrowLeft className="w-3 h-3" />
                            <span>Раньше</span>
                          </button>
                          <button
                            type="button"
                            disabled={loading || idx === selectedFiles.length - 1}
                            aria-label={'Переместить скриншот ' + (idx + 1) + ' позже'}
                            onClick={() => moveFile(idx, 1)}
                            className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-medium border border-slate-200 rounded py-1 hover:bg-slate-50 disabled:opacity-35"
                          >
                            <span>Позже</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Рекомендации по текстовому импорту</h3>
              <ul className="space-y-2 text-xs text-slate-600 list-disc pl-4 leading-relaxed">
                <li>Указывайте роль отправителя («Клиент», «Менеджер» или имя контакта).</li>
                <li>Сохраняйте хронологический порядок сообщений сверху вниз.</li>
                <li>Если клиент называл телефон, БИН или название компании — оставьте их в тексте для автоматической привязки.</li>
              </ul>
            </div>
          )}

          {mode === 'screenshot' && review && (
            <div className="bg-white border border-amber-300 rounded-xl p-5 space-y-4" aria-label="Проверка распознанной переписки">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Проверьте переписку перед сохранением</h3>
                <p className="text-xs text-slate-600 mt-1">Откройте скриншоты выше в полном размере и сверьте текст. В WhatsApp входящие сообщения обычно слева, исходящие справа. Исправьте автора, пропуски и порядок; затем подтвердите сохранение.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-slate-700">Имя клиента
                  <input value={review.parsed.clientName} onChange={e=>updateReview({clientName:e.target.value})} maxLength={200} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Телефон
                  <input value={review.parsed.phone||''} onChange={e=>updateReview({phone:e.target.value})} maxLength={40} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                </label>
              </div>
              <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1">
                {review.parsed.messages.map((message,index)=>(
                  <div key={index} className={`rounded-lg border p-3 space-y-2 ${message.sender==='CLIENT'?'bg-slate-50 border-slate-200':'bg-emerald-50 border-emerald-200'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500">#{index+1}</span>
                      <select aria-label={`Автор сообщения ${index+1}`} value={message.sender} onChange={e=>updateMessage(index,{sender:e.target.value as ReviewedMessage['sender']})} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold">
                        <option value="CLIENT">Клиент</option><option value="MANAGER">Я / менеджер</option>
                      </select>
                      <input aria-label={`Время сообщения ${index+1}`} value={message.time||''} onChange={e=>updateMessage(index,{time:e.target.value})} placeholder="Время, если известно" maxLength={60} className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs" />
                      <button type="button" disabled={index===0} onClick={()=>moveMessage(index,-1)} aria-label={`Сообщение ${index+1} раньше`} className="rounded border border-slate-300 bg-white p-1 disabled:opacity-30"><ArrowLeft className="w-3.5 h-3.5 rotate-90" /></button>
                      <button type="button" disabled={index===review.parsed.messages.length-1} onClick={()=>moveMessage(index,1)} aria-label={`Сообщение ${index+1} позже`} className="rounded border border-slate-300 bg-white p-1 disabled:opacity-30"><ArrowRight className="w-3.5 h-3.5 rotate-90" /></button>
                      <button type="button" disabled={review.parsed.messages.length===1} onClick={()=>updateReview({messages:review.parsed.messages.filter((_,i)=>i!==index)})} aria-label={`Удалить сообщение ${index+1}`} className="rounded border border-red-200 bg-white p-1 text-red-600 disabled:opacity-30"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <textarea aria-label={`Текст сообщения ${index+1}`} value={message.content} onChange={e=>updateMessage(index,{content:e.target.value})} rows={2} maxLength={10000} className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1.5 text-xs leading-relaxed" />
                  </div>
                ))}
              </div>
              <button type="button" onClick={()=>updateReview({messages:[...review.parsed.messages,{sender:'CLIENT',content:''}]})} disabled={review.parsed.messages.length>=300} className="text-xs font-semibold text-[#0082FB] disabled:opacity-40">+ Добавить пропущенное сообщение</button>
              <label className="block text-xs font-semibold text-slate-700">Суть обращения
                <textarea value={review.parsed.summary} onChange={e=>updateReview({summary:e.target.value})} rows={2} maxLength={5000} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
              </label>
              <label className="block text-xs font-semibold text-slate-700">Следующий шаг
                <textarea value={review.parsed.nextStep} onChange={e=>updateReview({nextStep:e.target.value})} rows={2} maxLength={2000} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={loading || !review.parsed.clientName.trim() || !review.parsed.summary.trim() || !review.parsed.nextStep.trim() || review.parsed.messages.some(message=>!message.content.trim())} onClick={handleSubmit} className="rounded-lg bg-[#0082FB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{loading?'Сохраняю…':'Подтвердить и сохранить'}</button>
                <button type="button" disabled={loading} onClick={()=>setReview(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">Распознать заново</button>
              </div>
              <p className="text-[11px] text-slate-500">Результат проверки действует 30 минут. До подтверждения клиент и сделка не создаются.</p>
            </div>
          )}

          {result && (
            <div className="bg-white border border-emerald-300 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{result.duplicate ? 'Эта часть переписки уже есть в CRM' : 'Новые сообщения сохранены в CRM'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onUploadSuccess(result.client)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white transition-colors"
                >
                  <span>Перейти к клиенту</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {result.overlapRemoved > 0 && !result.duplicate && (
                <p className="text-xs text-emerald-800">Повторные сообщения не добавлены: {result.overlapRemoved}. Сохранены только новые реплики.</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-900">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <p>
                    <span className="text-slate-500">Клиент:</span>{' '}
                    <strong>{result.client?.name}</strong>
                  </p>
                  <p>
                    <span className="text-slate-500">Телефон:</span>{' '}
                    {result.client?.phone || '—'}
                  </p>
                  <p>
                    <span className="text-slate-500">БИН/ИИН:</span>{' '}
                    {result.client?.binIin || '—'}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <p>
                    <span className="text-slate-500">Суть:</span> {result.parsed?.summary}
                  </p>
                  <p className="text-[#0082FB] font-semibold">
                    След. шаг: {result.parsed?.nextStep}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

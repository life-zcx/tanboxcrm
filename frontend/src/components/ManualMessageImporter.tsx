import React, {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,Plus,Trash2} from 'lucide-react';
import {api,ConversationChunk} from '../api';

type Row={id:string;sender:'CLIENT'|'MANAGER';content:string;dateTime:string};
const newRow=():Row=>({id:crypto.randomUUID(),sender:'CLIENT',content:'',dateTime:''});

function parseLabeledText(raw:string):Row[]{
  const rows:Row[]=[];
  for(const line of raw.replace(/\r\n?/g,'\n').split('\n')){
    const match=/^\s*(Клиент|Я|Менеджер)\s*[:：]\s*(.*)$/i.exec(line);
    if(match){rows.push({id:crypto.randomUUID(),sender:match[1].toLowerCase()==='клиент'?'CLIENT':'MANAGER',content:match[2],dateTime:''});continue;}
    if(!line.trim()&&!rows.length)continue;
    if(!rows.length)throw new Error('Начните каждое сообщение с «Клиент:» или «Я:».');
    rows[rows.length-1].content+='\n'+line;
  }
  if(!rows.length||rows.some(row=>!row.content.trim()))throw new Error('Каждому сообщению нужен непустой текст.');
  if(rows.length>100)throw new Error('За один раз можно добавить до 100 сообщений.');
  return rows;
}

export const ManualMessageImporter:React.FC<{clientId:string;onSaved:(chunk:ConversationChunk)=>void}>=({clientId,onSaved})=>{
  const [rows,setRows]=useState<Row[]>(()=>[newRow()]);
  const [channel,setChannel]=useState<'WHATSAPP'|'TELEGRAM'|'OTHER'>('WHATSAPP');
  const [note,setNote]=useState('');
  const [bulk,setBulk]=useState('');
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  useEffect(()=>{setRows([newRow()]);setNote('');setBulk('');setRequestId(crypto.randomUUID());setError('');setSuccess('');},[clientId]);
  const change=(id:string,patch:Partial<Row>)=>setRows(previous=>previous.map(row=>row.id===id?{...row,...patch}:row));
  const move=(index:number,direction:number)=>setRows(previous=>{
    const target=index+direction;if(target<0||target>=previous.length)return previous;
    const next=[...previous];[next[index],next[target]]=[next[target],next[index]];return next;
  });
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy)return;
    setError('');setSuccess('');setBusy(true);
    try{
      const messages=rows.map(row=>({sender:row.sender,content:row.content.trim(),...(row.dateTime?{time:new Date(row.dateTime).toISOString()}:{})}));
      if(messages.some(message=>!message.content))throw new Error('Заполните текст каждого сообщения.');
      if(messages.reduce((size,message)=>size+message.content.length,0)>200000)throw new Error('Слишком много текста. Разделите переписку на части.');
      const response=await api.addManualMessages(clientId,{requestId,channel,note:note.trim()||undefined,messages});
      onSaved(response.chunk);
      setRows([newRow()]);setNote('');setBulk('');setRequestId(crypto.randomUUID());
      setSuccess(response.duplicate?'Эти сообщения уже были сохранены.':'Сообщения добавлены в историю клиента.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не удалось сохранить сообщения.');}
    finally{setBusy(false);}
  };
  return <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
    <div><h3 className="text-sm font-bold text-slate-900">Добавить сообщения вручную</h3><p className="mt-1 text-xs text-slate-500">Текст и автор сохранятся так, как вы укажете. ИИ не меняет эти сообщения.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">Источник
        <select value={channel} disabled={busy} onChange={event=>setChannel(event.target.value as typeof channel)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="WHATSAPP">WhatsApp</option><option value="TELEGRAM">Telegram</option><option value="OTHER">Другое</option></select>
      </label>
      <label className="text-xs font-semibold text-slate-700">Заголовок фрагмента · необязательно
        <input value={note} disabled={busy} maxLength={500} onChange={event=>setNote(event.target.value)} placeholder="Например: Обсуждение доставки" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
      </label>
    </div>
    <div className="space-y-3">
      {rows.map((row,index)=><div key={row.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">#{index+1}</span>
          <select aria-label={`Автор сообщения ${index+1}`} value={row.sender} disabled={busy} onChange={event=>change(row.id,{sender:event.target.value as Row['sender']})} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"><option value="CLIENT">Клиент</option><option value="MANAGER">Я / менеджер</option></select>
          <input type="datetime-local" aria-label={`Дата сообщения ${index+1}`} value={row.dateTime} disabled={busy} onChange={event=>change(row.id,{dateTime:event.target.value})} className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs" />
          <button type="button" aria-label={`Сообщение ${index+1} раньше`} title="Раньше" disabled={busy||index===0} onClick={()=>move(index,-1)} className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-35"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={`Сообщение ${index+1} позже`} title="Позже" disabled={busy||index===rows.length-1} onClick={()=>move(index,1)} className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-35"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={`Удалить сообщение ${index+1}`} title="Удалить" disabled={busy||rows.length===1} onClick={()=>setRows(previous=>previous.filter(item=>item.id!==row.id))} className="rounded border border-red-200 bg-white p-1.5 text-red-600 disabled:opacity-35"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
        <textarea aria-label={`Текст сообщения ${index+1}`} value={row.content} disabled={busy} onChange={event=>change(row.id,{content:event.target.value})} rows={2} maxLength={4000} placeholder={row.sender==='CLIENT'?'Что написал клиент…':'Что ответили вы…'} className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed" />
      </div>)}
    </div>
    <button type="button" disabled={busy||rows.length>=100} onClick={()=>setRows(previous=>[...previous,newRow()])} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0082FB] disabled:opacity-40"><Plus className="h-4 w-4" /> Добавить сообщение</button>
    <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"><summary className="cursor-pointer font-semibold text-slate-700">Вставить сразу несколько сообщений</summary><p className="mt-2 text-slate-500">Начинайте каждое сообщение с «Клиент:» или «Я:». Строки без такого начала продолжат предыдущее сообщение. После разбора проверьте автора и порядок.</p><textarea value={bulk} disabled={busy} onChange={event=>setBulk(event.target.value)} rows={6} placeholder={'Клиент: Добрый день, нужна маркировка обуви.\nЯ: Добрый день! Сколько пар в партии?\nКлиент: 200 пар.'} className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2.5" /><button type="button" disabled={busy||!bulk.trim()} onClick={()=>{try{const parsed=parseLabeledText(bulk),current=rows.length===1&&!rows[0].content.trim()?0:rows.length;if(current+parsed.length>100)throw new Error('За один раз можно добавить до 100 сообщений.');setRows(previous=>previous.length===1&&!previous[0].content.trim()?parsed:[...previous,...parsed]);setBulk('');setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Не удалось разобрать текст.');}}} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Разобрать и проверить</button></details>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}
    {success&&<p role="status" className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700">{success}</p>}
    <div className="flex justify-end"><button type="submit" disabled={busy||rows.some(row=>!row.content.trim())} className="rounded-lg bg-[#0082FB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy?'Сохраняю…':`Сохранить ${rows.length} сообщ.`}</button></div>
  </form>;
};

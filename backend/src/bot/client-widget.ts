import {deflateSync} from 'node:zlib';
import {clientStatuses} from '../lib/validation';

export const widgetStatusLabels:Record<(typeof clientStatuses)[number],string>={
  LEAD:'Новый лид',IN_NEGOTIATION:'Переговоры',KP_SENT:'КП отправлено',
  PAYMENT_PENDING:'Ожидает оплаты',IN_PROGRESS:'В работе',WON:'Оплачено',LOST:'Отказ',
};

type WidgetClient={id:string;name:string;company:string|null;status:string;aiNextStep:string|null};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

export function clientWidgetHtml(client:WidgetClient){
  const id=client.id;
  const buttons=clientStatuses.map(status=>`<button onclick="setStatus('${status}')">${widgetStatusLabels[status]}</button>`).join('');
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;margin:12px;color:var(--tg-theme-text-color)}
h3{margin:0 0 6px;font-size:17px}p{margin:6px 0}small{color:var(--tg-theme-hint-color)}
.badge{display:inline-block;padding:4px 9px;border-radius:10px;background:var(--tg-theme-secondary-bg-color)}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}button{padding:7px 9px;border-radius:8px}
#statuses{display:none;margin-top:8px}#notice{min-height:1.2em}
</style></head><body>
<h3>👤 ${escapeHtml(client.name.slice(0,100))}</h3>
<small>${escapeHtml((client.company||'Компания не указана').slice(0,100))}</small>
<p>Статус: <span class="badge" id="status">${widgetStatusLabels[client.status as keyof typeof widgetStatusLabels]||escapeHtml(client.status)}</span></p>
<p>Следующий шаг: <span id="next">${escapeHtml((client.aiNextStep||'Уточнить задачу').slice(0,160))}</span></p>
<div class="actions"><button onclick="toggleStatuses()">Изменить статус</button><button onclick="refresh()">Обновить</button></div>
<div class="actions" id="statuses">${buttons}</div><small id="notice"></small>
<script>
var clientId=${JSON.stringify(id)};
function show(data){if(!data||!data.ok)return;document.getElementById('status').textContent=data.label;document.getElementById('next').textContent=data.next;document.getElementById('notice').textContent='Данные обновлены';}
function request(action){TelegramWidget.request(action).then(function(reply){var data=JSON.parse(reply.result||'{}');if(data.ok)show(data);else document.getElementById('notice').textContent=data.error||'Не удалось обновить';},function(){document.getElementById('notice').textContent='Ошибка соединения. Повторите попытку.';});}
function toggleStatuses(){var panel=document.getElementById('statuses');panel.style.display=panel.style.display==='flex'?'none':'flex';}
function setStatus(status){request('w:set:'+clientId+':'+status);}
function refresh(){request('w:refresh:'+clientId);}
refresh();
</script></body></html>`;
  if(Buffer.byteLength(html)>32768||deflateSync(html,{level:9}).length>4096)throw new Error('Widget exceeds Telegram limits');
  return html;
}

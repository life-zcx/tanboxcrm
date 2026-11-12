"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardWidgetHtml = dashboardWidgetHtml;
const node_zlib_1 = require("node:zlib");
function dashboardWidgetHtml(screen) {
    const initial = JSON.stringify('w2:' + screen).replace(/</g, '\\u003c');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;color:var(--tg-theme-text-color);margin:12px}
h3{margin:0 0 5px;font-size:18px}p{margin:0 0 10px;color:var(--tg-theme-hint-color);white-space:pre-wrap}
#rows{display:flex;flex-direction:column;gap:6px}button,.line{width:100%;box-sizing:border-box;text-align:left;padding:9px 11px;border-radius:9px}
.line{background:var(--tg-theme-secondary-bg-color)}small{display:block;min-height:1.2em;margin-top:8px;color:var(--tg-theme-hint-color)}
#close{margin-top:9px;width:100%;padding:8px;border-radius:9px}
</style></head><body><h3 id="title">TANBOX CRM</h3><p id="subtitle">Загружаю данные…</p><div id="rows"></div><small id="notice"></small>
<button id="close" onclick="request('w2:close')">✖️ Закрыть</button>
<script>
var TW=window.TelegramWidget;
function el(id){return document.getElementById(id)}
function draw(data){
 if(!data.ok){el('notice').textContent=data.error||'Не удалось загрузить';return}
 el('title').textContent=data.title;el('subtitle').textContent=data.subtitle||'';el('notice').textContent='';
 var box=el('rows');box.replaceChildren();
 (data.rows||[]).forEach(function(row){
  var node=document.createElement(row.action||row.url||row.copy?'button':'div');node.textContent=row.text;
  if(row.action)node.onclick=function(){request(row.action)};
  if(row.url)node.onclick=function(){TW.openLink(row.url)};
  if(row.copy)node.onclick=function(){TW.copyText(row.copy)};
  if(!row.action&&!row.url&&!row.copy)node.className='line';box.appendChild(node);
 });
}
function request(action){
 el('notice').textContent='Загружаю…';
 TW.request(action).then(function(answer){
  var data={};try{data=JSON.parse(answer.result||'{}')}catch(e){}
  if(data.rows)draw(data);else el('notice').textContent=data.notice||data.error||'Готово';
 },function(error){el('notice').textContent=error.code==='BUSY'?'Подождите ответа':'Не удалось связаться с ботом';});
}
request(${initial});
</script></body></html>`;
    if (Buffer.byteLength(html) > 32768 || (0, node_zlib_1.deflateSync)(html, { level: 9 }).length > 4096)
        throw new Error('Dashboard widget exceeds Telegram limits');
    return html;
}

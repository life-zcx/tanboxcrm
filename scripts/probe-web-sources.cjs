const fs=require('node:fs');
async function main(){
 fs.mkdirSync('test-results/web-probe',{recursive:true});
 for(const [key,url] of Object.entries({adilet:'https://adilet.zan.kz/rus/docs/G26TI000199',operator:'https://tanba.telecom.kz/ru/business/documents',old:'https://old.adilet.zan.kz/rus/docs/G26TI000199'})){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const html=await r.text();fs.writeFileSync('test-results/web-probe/'+key+'.html',html);console.log(JSON.stringify({key,status:r.status,length:html.length,scripts:[...html.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(m=>m[1]),links:[...html.matchAll(/href=["']([^"']+\.(?:pdf|docx|xlsx)[^"']*)/g)].map(m=>m[1]).slice(0,15)}));}catch(e){console.log(key+': '+e.message);}
 }
}
main();

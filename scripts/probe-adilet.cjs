const fs=require('node:fs');
async function main(){
 const url='https://adilet.zan.kz/assets/index-BZoZb4mb.js';
 const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const text=await r.text();fs.writeFileSync('test-results/web-probe/adilet-app.js',text);
 const patterns=[...text.matchAll(/.{0,100}(?:\/api\/|baseURL|documents\/|document\/|apiUrl).{0,170}/g)].map(m=>m[0]);
 console.log(JSON.stringify({status:r.status,length:text.length,matches:patterns.slice(0,35)},null,2));
 for(const term of ['async function DI','yN=','document_code','documentId','external_id']){const i=text.indexOf(term);console.log(term+': '+text.slice(Math.max(0,i-200),i+650));}
 for(const url of ['https://adilet.zan.kz/api/documents/search?q=G26TI000199','https://adilet.zan.kz/api/documents/search?query=маркировки&page_size=5']){
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});const body=await response.text();console.log(JSON.stringify({url,status:response.status,body:body.slice(0,1800)}));
 }
}
main().catch(e=>console.error(e.message));

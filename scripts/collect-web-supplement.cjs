const fs=require('node:fs');
const {webSeeds}=require('../backend/dist/knowledge/web.registry');
const {captureWeb}=require('../backend/dist/knowledge/web.fetch');
const {discoverSources}=require('../backend/dist/knowledge/web.discovery');
const target='backend/data/web-supplement.ndjson';
const queue=webSeeds.filter(s=>s.url.includes('eec.eaeunion.org')),seen=new Set();
async function main(){
 let ready=0,attention=0;
 while(queue.length&&seen.size<120){
  const seed=queue.shift();if(seen.has(seed.url))continue;seen.add(seed.url);
  try{
   const capture=await captureWeb(seed.url),discovered=discoverSources(seed,capture.metadata.links);
   fs.appendFileSync(target,JSON.stringify({seed,capturedAt:new Date().toISOString(),capture:{...capture,data:capture.data.toString('base64')},discovered})+'\n');
   queue.push(...discovered.filter(s=>!seen.has(s.url)));
   if(capture.quality==='FULLTEXT')ready++;else attention++;
  }catch(e){attention++;fs.appendFileSync(target,JSON.stringify({seed,capturedAt:new Date().toISOString(),error:e.code||e.message,discovered:[]})+'\n');}
  if(seen.size%5===0)console.log(JSON.stringify({processed:seen.size,queued:queue.length,ready,attention}));
  await new Promise(r=>setTimeout(r,300));
 }
 console.log(JSON.stringify({sources:seen.size,ready,attention,pending:queue.length}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

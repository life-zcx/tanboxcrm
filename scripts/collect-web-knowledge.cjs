// Public official sources only. Resume snapshots without fetching successful
// documents again. Run after building backend. Does not read the CRM database.
const fs=require('node:fs'),path=require('node:path');
const {webSeeds}=require('../backend/dist/knowledge/web.registry');
const {captureWeb}=require('../backend/dist/knowledge/web.fetch');
const {discoverSources}=require('../backend/dist/knowledge/web.discovery');
const target=path.join(__dirname,'../backend/data/web-captures.ndjson');
const max=Number(process.argv.find(s=>s.startsWith('--max='))?.split('=')[1]||180);
const records=new Map(),registry=new Map(webSeeds.map(s=>[s.url,s]));
if(fs.existsSync(target))for(const line of fs.readFileSync(target,'utf8').split('\n').filter(Boolean)){
 const item=JSON.parse(line);records.set(item.seed.url,item);registry.set(item.seed.url,item.seed);
 for(const child of item.discovered||[])if(!registry.has(child.url))registry.set(child.url,child);
}
async function main(){
 let attempted=0;
 const processed=new Set([...records].filter(([,r])=>r.capture&&r.capture.quality==='FULLTEXT').map(([u])=>u));
 while(attempted<max){
  const pending=[...registry.values()].filter(s=>!processed.has(s.url)).sort((a,b)=>a.priority-b.priority).slice(0,2);
  if(!pending.length)break;
  await Promise.all(pending.map(async seed=>{
   processed.add(seed.url);attempted++;
   let item;
   try{
    const capture=await captureWeb(seed.url);const discovered=discoverSources(seed,capture.metadata.links);
    item={seed,capturedAt:new Date().toISOString(),capture:{...capture,data:capture.data.toString('base64')},discovered};
    for(const child of discovered)if(!registry.has(child.url))registry.set(child.url,child);
   }catch(error){item={seed,capturedAt:new Date().toISOString(),error:error.code||error.message,discovered:[]};}
   records.set(seed.url,item);fs.appendFileSync(target,JSON.stringify(item)+'\n','utf8');
   if(attempted%5===0||item.error)console.log(JSON.stringify({attempted,registered:registry.size,fullText:[...records.values()].filter(r=>r.capture?.quality==='FULLTEXT').length,lastQuality:item.capture?.quality||item.error,last:seed.title.slice(0,65)}));
  }));
  await new Promise(r=>setTimeout(r,500));
 }
 const report={registered:registry.size,attempted,records:records.size,fullText:[...records.values()].filter(r=>r.capture?.quality==='FULLTEXT').length,sourceBytes:[...records.values()].reduce((n,r)=>n+(r.capture?Buffer.from(r.capture.data,'base64').length:0),0),pending:[...registry.values()].filter(s=>!records.has(s.url)).length,failures:[...records.values()].filter(r=>r.error||r.capture.quality!=='FULLTEXT').map(r=>({title:r.seed.title,url:r.seed.url,status:r.capture?.quality||'ERROR',error:r.error||null}))};
 fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/web-collection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,failures:report.failures.length},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

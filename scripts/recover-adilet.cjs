const path=require('node:path');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {prisma}=require('../backend/dist/config/db');
const {captureWeb}=require('../backend/dist/knowledge/web.fetch');
const {saveWebCapture}=require('../backend/dist/knowledge/web.service');
const {webSeeds}=require('../backend/dist/knowledge/web.registry');

(async()=>{
  const sources=await prisma.webKnowledgeSource.findMany({where:{status:'NEEDS_BROWSER',url:{startsWith:'https://adilet.zan.kz/rus/docs/'}},orderBy:[{priority:'asc'},{url:'asc'}]});
  let recovered=0;
  for(const source of sources){
    if(!/^https:\/\/adilet\.zan\.kz\/rus\/docs\/[A-Za-z0-9_]+$/.test(source.url))continue;
    const seed=webSeeds.find(s=>s.url===source.url)||{url:source.url,title:source.title,authority:source.authority,language:source.language,categoryCodes:source.categoryCodes,topics:source.topics,depth:source.depth,priority:source.priority,intervalHours:source.intervalHours,discoveredFrom:source.discoveredFrom||undefined};
    try{
      const capture=await captureWeb(source.url);
      if(capture.quality!=='FULLTEXT'){console.log(JSON.stringify({url:source.url,quality:capture.quality}));continue;}
      const result=await saveWebCapture(seed,capture);
      recovered++;
      console.log(JSON.stringify({url:source.url,quality:result.quality,characters:result.characters,originalBytes:capture.data.length}));
    }catch(error){console.log(JSON.stringify({url:source.url,error:error.message}));}
  }
  console.log(JSON.stringify({attempted:sources.length,recovered}));
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>prisma.$disconnect());

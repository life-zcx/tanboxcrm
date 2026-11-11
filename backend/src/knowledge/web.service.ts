import {Prisma} from '@prisma/client';
import {prisma} from '../config/db';
import {sha256,splitPassages} from './archive.service';
import {captureWeb,approvedUrl,type Capture} from './web.fetch';
import {discoverSources} from './web.discovery';
import {webSeeds,webCategories,webTopics,type WebSeed} from './web.registry';
import {env} from '../config/env';
import {isSupportingTechnicalSource,sharedOperatorDocumentIds} from './web.scope';

export function semanticHash(text:string){return sha256(text.replace(/(?:Дата скачивания|Сақтау күні)\s+\d{2}\.\d{2}\.\d{4}/g,''));}
export const normalQuote=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim();
export async function seedWebRegistry(){
  for(const c of webCategories)await prisma.webKnowledgeCategory.upsert({where:{code:c.code},create:c,update:c});
  for(const source of webSeeds)await registerSource(source);
}
export async function registerSource(seed:WebSeed){
  const url=approvedUrl(seed.url);
  const existing=await prisma.webKnowledgeSource.findUnique({where:{url}});
  if(existing){
    return prisma.webKnowledgeSource.update({where:{id:existing.id},data:{categoryCodes:[...new Set([...existing.categoryCodes,...seed.categoryCodes])],topics:existing.currentRevisionId?existing.topics:[...new Set([...existing.topics,...seed.topics])]}});
  }
  return prisma.webKnowledgeSource.create({data:{...seed,url}});
}
export async function saveWebCapture(seed:WebSeed,capture:Capture,capturedAt=new Date()){
  if(sha256(capture.data)!==capture.sha256)throw new Error('WEB_SOURCE_CHECKSUM_MISMATCH');
  if(capture.url!==seed.url||capturedAt.getTime()>Date.now()+60000)throw new Error('WEB_CAPTURE_PROVENANCE_MISMATCH');
  if(capture.quality==='FULLTEXT'&&capture.metadata.pages){
    const pages=capture.text.split(/-- \d+ of \d+ --/).slice(0,capture.metadata.pages);
    if(pages.some(page=>page.replace(/\s/g,'').length<40))capture={...capture,quality:'NEEDS_OCR',metadata:{...capture.metadata,note:'Часть страниц не содержит извлечённого текста; необходим OCR.'}};
  }
  const source=await registerSource(seed);
  const revision=await prisma.$transaction(async tx=>{
    const contentHash=semanticHash(capture.text);
    let revision=await tx.webKnowledgeRevision.findUnique({where:{sourceId_sha256_contentHash:{sourceId:source.id,sha256:capture.sha256,contentHash}},select:{id:true,quality:true,contentHash:true}});
    if(!revision){
      revision=await tx.webKnowledgeRevision.create({data:{sourceId:source.id,sha256:capture.sha256,contentHash:semanticHash(capture.text),finalUrl:capture.finalUrl,contentType:capture.contentType,data:capture.data,text:capture.text,title:capture.title||seed.title,quality:capture.quality,metadata:capture.metadata as Prisma.InputJsonValue,fetchedAt:capturedAt},select:{id:true,quality:true,contentHash:true}});
      const chunks=splitPassages(capture.text);
      for(let offset=0;offset<chunks.length;offset+=100)await tx.webKnowledgePassage.createMany({data:chunks.slice(offset,offset+100).map((content,i)=>({revisionId:revision!.id,position:offset+i,content}))});
    }
    const ready=capture.quality==='FULLTEXT';
    const words:Record<string,RegExp>={applicability:/перечень|подлежат|исключен|ТН ВЭД/i,dates:/202[0-9]|этап|остатк|вступ|переходн/i,registration:/регистрац|карточ[а-я]*|модерац|каталог|GTIN|ЭЦП/i,codes:/код.*маркиров|эмисси|заказ.*код|СУЗ/i,labels:/нанес|этикет|печать|носител|бирк/i,warehouse:/агрег|склад|SSCC|короб/i,circulation:/оборот|продаж|передач|рознич/i,returns:/возврат|списан|поврежд|перемаркир/i,customs:/тамож|импорт|экспорт|реимпорт/i,integration:/API|1С|ККМ|ОФД|интеграц/i,liability:/ответственност|штраф|КоАП|нарушен/i,pricing:/тариф|стоимост|тенге|оплат|НДС/i};
    const topics=(seed.url.includes('/documents/225827/')?['applicability','dates']:seed.topics).filter(t=>words[t]?.test(capture.text));
    // Replaying an older snapshot preserves its history without rolling back
    // the current source, its collection status or its approved evidence.
    const updated=await tx.webKnowledgeSource.updateMany({where:{id:source.id,OR:[{lastAttemptAt:null},{lastAttemptAt:{lte:capturedAt}}]},data:{topics,status:ready?'READY':capture.quality,lastError:ready?null:capture.metadata.note||capture.quality,lastHttpStatus:capture.status,lastAttemptAt:capturedAt,...(ready?{lastSuccessAt:capturedAt}:{}),currentRevisionId:revision.id,lockedUntil:null,nextCheckAt:new Date(capturedAt.getTime()+(ready?source.intervalHours:6)*3600000)}});
    if(updated.count){
      const evidence=await tx.webKnowledgeEvidence.findMany({where:{revision:{sourceId:source.id}},include:{revision:{select:{contentHash:true}}}});
      const invalid=evidence.filter(e=>e.revision.contentHash!==revision!.contentHash||capture.quality!=='FULLTEXT').map(e=>e.factId);
      if(invalid.length)await tx.webKnowledgeFact.updateMany({where:{id:{in:invalid},status:'APPROVED'},data:{status:'RECHECK'}});
    }
    return revision;
  },{timeout:60000});
  const discovered=discoverSources(seed,capture.metadata.links);
  for(const child of discovered)await registerSource(child);
  return {sourceId:source.id,revisionId:revision.id,quality:revision.quality,characters:capture.text.length,discovered:discovered.length};
}
export async function recordWebFailure(seed:WebSeed,error:string,capturedAt=new Date()){
  const source=await registerSource(seed);
  const current=source.currentRevisionId?await prisma.webKnowledgeRevision.findUnique({where:{id:source.currentRevisionId},select:{quality:true}}):null;
  // A failed refresh must not hide an already archived, usable edition.
  const status=current?(current.quality==='FULLTEXT'?'READY':current.quality):'FETCH_ERROR';
  await prisma.webKnowledgeSource.updateMany({where:{id:source.id,OR:[{lastAttemptAt:null},{lastAttemptAt:{lte:capturedAt}}]},data:{status,lastError:error.slice(0,500),lastAttemptAt:capturedAt,lockedUntil:null,nextCheckAt:new Date(Date.now()+6*3600000)}});
}
let running=false;
export async function collectDue(limit=5){
  if(running)return {busy:true};running=true;
  let run:Awaited<ReturnType<typeof prisma.webKnowledgeRun.create>>|undefined;
  const result={attempted:0,ready:0,attention:0,errors:0};
  try{
    run=await prisma.webKnowledgeRun.create({data:{}});
    const sources=await prisma.webKnowledgeSource.findMany({where:{enabled:true,nextCheckAt:{lte:new Date()},OR:[{lockedUntil:null},{lockedUntil:{lt:new Date()}}]},orderBy:[{priority:'asc'},{nextCheckAt:'asc'}],take:limit});
    for(const source of sources){
      const locked=await prisma.webKnowledgeSource.updateMany({where:{id:source.id,OR:[{lockedUntil:null},{lockedUntil:{lt:new Date()}}]},data:{lockedUntil:new Date(Date.now()+20*60000)}});
      if(!locked.count)continue;
      result.attempted++;
      const seed:WebSeed={url:source.url,title:source.title,authority:source.authority,language:source.language,categoryCodes:source.categoryCodes,topics:source.topics,depth:source.depth,priority:source.priority,intervalHours:source.intervalHours,discoveredFrom:source.discoveredFrom||undefined};
      try{const capture=await captureWeb(source.url);await saveWebCapture(seed,capture);if(capture.quality==='FULLTEXT')result.ready++;else result.attention++;}
      catch(error:any){result.errors++;await recordWebFailure(seed,error.code||error.message||'FETCH_ERROR');}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    await prisma.webKnowledgeRun.update({where:{id:run.id},data:{finishedAt:new Date(),state:result.errors||result.attention?'WITH_GAPS':'DONE',result}});
    return result;
  }catch(error){if(run)await prisma.webKnowledgeRun.update({where:{id:run.id},data:{finishedAt:new Date(),state:'FAILED',result}}).catch(()=>{});throw error;}
  finally{running=false;}
}
export interface FactInput {key:string;title:string;answer:string;categoryCodes:string[];topic:string;keywords:string[];conditions:Prisma.InputJsonValue;reviewedBy:string;validFrom?:Date;validTo?:Date;reviewDueAt:Date;evidence:{revisionId:string;quote:string;locator:string}[];}
export async function publishFact(input:FactInput){
  if(!input.evidence.length)throw new Error('FACT_REQUIRES_EVIDENCE');
  for(const e of input.evidence){
    const revision=await prisma.webKnowledgeRevision.findUniqueOrThrow({where:{id:e.revisionId},include:{source:true}});
    if(revision.quality!=='FULLTEXT'||!['LAW','GOVERNMENT','OPERATOR','STANDARD'].includes(revision.source.authority)||revision.source.status!=='READY')throw new Error('FACT_SOURCE_NOT_READY');
    if(normalQuote(e.quote).length<40||!normalQuote(revision.text).includes(normalQuote(e.quote)))throw new Error('FACT_QUOTE_NOT_FOUND');
    if(revision.source.currentRevisionId!==revision.id)throw new Error('FACT_SOURCE_SUPERSEDED');
  }
  const {evidence,...fact}=input;
  return prisma.$transaction(async tx=>{
    const saved=await tx.webKnowledgeFact.upsert({where:{key:fact.key},create:{...fact,status:'APPROVED',reviewedAt:new Date()},update:{...fact,status:'APPROVED',reviewedAt:new Date()}});
    await tx.webKnowledgeEvidence.deleteMany({where:{factId:saved.id}});
    await tx.webKnowledgeEvidence.createMany({data:evidence.map(e=>({...e,factId:saved.id}))});return saved;
  });
}
export async function usableFacts(asOf=new Date()){
  const facts=await prisma.webKnowledgeFact.findMany({where:{status:'APPROVED',reviewDueAt:{gt:asOf},AND:[{OR:[{validFrom:null},{validFrom:{lte:asOf}}]},{OR:[{validTo:null},{validTo:{gt:asOf}}]}]},include:{evidence:{include:{revision:{select:{id:true,sourceId:true,contentHash:true,text:true,source:true}}}}}});
  const current=await prisma.webKnowledgeRevision.findMany({where:{id:{in:facts.flatMap(f=>f.evidence.map(e=>e.revision.source.currentRevisionId||''))}},select:{id:true,contentHash:true,text:true,quality:true}});
  return facts.filter(f=>f.evidence.length&&f.evidence.every(e=>{
    const revision=current.find(r=>r.id===e.revision.source.currentRevisionId);
    return revision?.quality==='FULLTEXT'&&e.revision.source.status==='READY'&&revision.contentHash===e.revision.contentHash&&normalQuote(revision.text).includes(normalQuote(e.quote))&&!!e.revision.source.lastSuccessAt&&asOf.getTime()-e.revision.source.lastSuccessAt.getTime()<8*86400000;
  }));
}
export async function webOverview(){
  const [categories,sources,facts,runs]=await Promise.all([
    prisma.webKnowledgeCategory.findMany({orderBy:{title:'asc'}}),
    prisma.webKnowledgeSource.findMany({orderBy:[{priority:'asc'},{title:'asc'}],select:{id:true,url:true,title:true,authority:true,language:true,categoryCodes:true,topics:true,status:true,lastError:true,lastAttemptAt:true,lastSuccessAt:true,nextCheckAt:true,currentRevisionId:true,discoveredFrom:true}}),
    usableFacts(),prisma.webKnowledgeRun.findMany({orderBy:{startedAt:'desc'},take:5}),
  ]);
  const coreSources=sources.filter(s=>!isSupportingTechnicalSource(s));
  const supportingSources=sources.filter(isSupportingTechnicalSource);
  const currentRevisions=await prisma.webKnowledgeRevision.findMany({where:{id:{in:coreSources.flatMap(s=>s.currentRevisionId?[s.currentRevisionId]:[])}},select:{id:true,sha256:true}});
  const sharedDocuments=sharedOperatorDocumentIds(coreSources,currentRevisions);
  const sourceCounts=(items:typeof sources)=>({sources:items.length,collected:items.filter(s=>s.status==='READY').length,pending:items.filter(s=>s.status==='PENDING').length,attention:items.filter(s=>!['READY','PENDING'].includes(s.status)).length});
  const matrix=categories.map(c=>({...c,topics:Object.entries(webTopics).map(([topic,title])=>{
    // A generic source does not prove that a specific product category is covered.
    const related=coreSources.filter(s=>!sharedDocuments.has(s.id)&&s.categoryCodes.includes(c.code)&&s.topics.includes(topic));
    const reviewed=facts.filter(f=>f.categoryCodes.includes(c.code)&&f.topic===topic);
    return {topic,title,sources:related.length,collected:related.filter(s=>s.status==='READY').length,reviewed:reviewed.length,status:reviewed.length?'PARTIALLY_REVIEWED':related.some(s=>s.status==='READY')?'COLLECTED_UNREVIEWED':'GAP'};
  })}));
  return {categories,sources:sources.map(s=>({...s,supportingTechnical:isSupportingTechnicalSource(s),sharedDocument:sharedDocuments.has(s.id)})),matrix,runs,monitoring:{enabled:env.KNOWLEDGE_AUTO_COLLECT,intervalSeconds:60},stats:{...sourceCounts(sources),publishedFacts:facts.length},coreStats:sourceCounts(coreSources),supportingStats:sourceCounts(supportingSources),sharedDocumentCount:sharedDocuments.size,topics:webTopics};
}

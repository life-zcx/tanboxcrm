import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,writeFile,readFile,mkdir,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app';
import {prisma} from '../src/config/db';
import {env} from '../src/config/env';
import {issueCode} from '../src/modules/auth/auth.service';
import {geminiService} from '../src/ai/gemini.service';
import {aiOrchestrator} from '../src/ai/ai.orchestrator';
import {loadPricing} from '../src/pricing/pricing.service';
import {prepareImages} from '../src/lib/files';
import {createTelegramScreenshotDraft,updateTelegramScreenshotDraft,commitTelegramScreenshotDraft,cleanupExpiredScreenshotDrafts,discardScreenshotDraft} from '../src/bot/screenshot-drafts.service';
import {TelegramBotService,BOT_LABELS} from '../src/bot/telegram.bot';
import {Telegram} from 'telegraf';
import {getSystemPromptContext} from '../src/ai/knowledge.service';
import {seedKnowledge} from '../src/seed';
import {flushFileDeletions,deleteClientCompletely} from '../src/modules/clients/client-deletion.service';
import {importArchive,validateBundle,verifyArchive,activeArchive,sha256,canonical,documentDigest} from '../src/knowledge/archive.service';
import type {Server} from 'node:http';
let server:Server,origin:string,directory:string,cookie:string;
const approved='8563274673';
async function call(route:string,options:RequestInit={}){
  return fetch(origin+route,{...options,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',...options.headers}});
}
function cookieFrom(response:Response,name:string){return response.headers.getSetCookie().find(c=>c.startsWith(name+'='))!.split(';')[0];}
async function challenge(){
  const response=await call('/api/auth/request-code',{method:'POST',body:'{}'});
  assert.equal(response.status,200);
  const body=await response.json() as any;
  const id=new URL(body.botUrl).searchParams.get('start')!.slice(6);
  const browserCookie=cookieFrom(response,'tanbox_challenge');
  const code=await issueCode(id,approved,'test-owner');
  return {id,code,browserCookie};
}
before(async()=>{
  if(!process.env.CRM_TEST_DATABASE)throw new Error('Integration tests require the isolated test runner');
  directory=await mkdtemp(path.join(os.tmpdir(),'tanbox-regression-'));
  env.UPLOADS_DIR=directory;
  server=await new Promise<Server>(resolve=>{const app=createApp().listen(0,'127.0.0.1',()=>resolve(app));});
  origin='http://127.0.0.1:'+String((server.address() as any).port);
});
after(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.$disconnect();
  const resolved=path.resolve(directory);
  assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('tanbox-regression-'));
  await rm(resolved,{recursive:true,force:true});
});
test('approved browser login, OTP race, rejected masters and revoked sessions',async()=>{
  const c=await challenge();
  const stored=await prisma.authCode.findUniqueOrThrow({where:{id:c.id}});
  assert.notEqual(stored.code,c.code);
  const missing=await call('/api/auth/verify-code',{method:'POST',body:JSON.stringify({code:c.code})});
  assert.equal(missing.status,400);
  const attempts=await Promise.all([1,2].map(()=>call('/api/auth/verify-code',{method:'POST',headers:{Cookie:c.browserCookie},body:JSON.stringify({code:c.code})})));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]);
  const ok=attempts.find(r=>r.status===200)!;
  cookie=cookieFrom(ok,'tanbox_session');
  assert(ok.headers.getSetCookie().some(c=>c.startsWith('tanbox_session=')&&c.includes('HttpOnly')&&c.includes('SameSite=Strict')));
  const body=await ok.json() as any;assert(!body.token);assert.equal(body.user.telegramChatId,approved);
  assert.equal((await call('/api/auth/me',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await call('/api/clients',{headers:{Authorization:'Bearer '+jwt.sign({id:'fake',role:'ADMIN'},'tanbox-crm-super-secure-jwt-2026')}})).status,401);
  for(const code of ['777888','tanbox-crm-secret-2026']){
    assert.equal((await call('/api/auth/verify-code',{method:'POST',body:JSON.stringify({code})})).status,400);
  }
  const forged=jwt.sign({sub:randomUUID(),jti:randomUUID()},env.JWT_SECRET,{issuer:'tanbox-crm',audience:'tanbox-web'});
  assert.equal((await call('/api/clients',{headers:{Cookie:'tanbox_session='+forged}})).status,401);
});
test('OTP cannot be guessed indefinitely and unapproved Telegram IDs cannot bind it',async()=>{
  const c=await challenge();
  await assert.rejects(issueCode(c.id,'999999','stranger'));
  for(let i=0;i<5;i++)assert.equal((await call('/api/auth/verify-code',{method:'POST',headers:{Cookie:c.browserCookie},body:JSON.stringify({code:'000000'})})).status,400);
  // Direct DB state verifies persistence even when request limiting takes over.
  assert.equal((await prisma.authCode.findUniqueOrThrow({where:{id:c.id}})).attempts,5);
});
test('client/deal changes validate inputs and synchronize statuses',async()=>{
  const created=await call('/api/clients',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({name:'Test client',phone:'+7 707 123 45 67'})});
  assert.equal(created.status,201);const {client}=await created.json() as any;
  assert.equal(client.phone,'77071234567');
  assert.equal(await prisma.deal.count({where:{clientId:client.id}}),1);
  const rejected=await call('/api/clients/'+client.id,{method:'PUT',headers:{Cookie:cookie},body:JSON.stringify({deals:{deleteMany:{}}})});
  assert.equal(rejected.status,400);assert.equal(await prisma.deal.count({where:{clientId:client.id}}),1);
  const deal=await prisma.deal.findFirstOrThrow({where:{clientId:client.id}});
  assert.equal((await call('/api/deals/'+deal.id+'/stage',{method:'PUT',headers:{Cookie:cookie},body:JSON.stringify({stage:'PAID'})})).status,200);
  assert.equal((await prisma.client.findUniqueOrThrow({where:{id:client.id}})).status,'WON');
  await call('/api/clients/'+client.id,{method:'PUT',headers:{Cookie:cookie},body:JSON.stringify({status:'LOST'})});
  assert.equal((await prisma.deal.findUniqueOrThrow({where:{id:deal.id}})).stage,'CLOSED_LOST');
});
test('uploads reject forged content; accepted images require authentication and deletion removes files',async()=>{
  const fake=new FormData();fake.append('screenshots',new Blob(['<html>bad</html>'],{type:'image/png'}),'attack.html');
  let r=await fetch(origin+'/api/messages/preview-screenshot',{method:'POST',headers:{Cookie:cookie,Origin:env.APP_ORIGIN},body:fake});
  assert.equal(r.status,415);
  const original=geminiService.parseScreenshotsBatch;
  geminiService.parseScreenshotsBatch=async()=>({clientName:'Image client',sentiment:'NEUTRAL',summary:'Test',nextStep:'Call',category:'OTHER',messages:[{sender:'CLIENT',content:'Hello',senderName:undefined,time:'14:32'}]});
  try{
    const image=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer();
    const form=new FormData();form.append('screenshots',new Blob([new Uint8Array(image)],{type:'image/png'}),'good.png');
    const before=await prisma.client.count();
    r=await fetch(origin+'/api/messages/preview-screenshot',{method:'POST',headers:{Cookie:cookie,Origin:env.APP_ORIGIN},body:form});
    assert.equal(r.status,200);const preview=await r.json() as any;
    assert.equal(await prisma.client.count(),before);
    preview.parsed.messages[0].sender='MANAGER';
    const commit=new FormData();commit.append('screenshots',new Blob([new Uint8Array(image)],{type:'image/png'}),'good.png');commit.append('reviewToken',preview.reviewToken);commit.append('parsed',JSON.stringify(preview.parsed));
    r=await fetch(origin+'/api/messages/commit-screenshot',{method:'POST',headers:{Cookie:cookie,Origin:env.APP_ORIGIN},body:commit});
    assert.equal(r.status,201);const {result}=await r.json() as any;
    assert.equal(result.chunk.messages[0].sender,'MANAGER');
    const url=result.chunk.screenshotUrl;
    assert.equal((await call(url)).status,401);
    assert.equal((await call(url,{headers:{Cookie:cookie}})).status,200);
    assert.equal(result.chunk.messages[0].timestamp,null);
    await call('/api/clients/'+result.client.id,{method:'DELETE',headers:{Cookie:cookie}});
    assert.equal((await call(url,{headers:{Cookie:cookie}})).status,404);
  }finally{geminiService.parseScreenshotsBatch=original;}
});
test('manual messages attach to one client exactly as entered, in order, without AI',async()=>{
  const client=await prisma.client.create({data:{name:'Manual entry fixture'}}),requestId=randomUUID();
  const route='/api/messages/client/'+client.id+'/manual';
  const payload={requestId,channel:'WHATSAPP',note:'Обсуждение партии',messages:[
    {sender:'CLIENT',content:'Добрый день',time:'2026-11-11T09:38:00.000+05:00'},
    {sender:'MANAGER',content:'Уточните количество пар'},
  ]};
  assert.equal((await call(route,{method:'POST',body:JSON.stringify(payload)})).status,401);
  const original=geminiService.parseTextDialogue;
  geminiService.parseTextDialogue=async()=>{throw new Error('AI must not run for manual messages');};
  try{
    let response=await call(route,{method:'POST',headers:{Cookie:cookie},body:JSON.stringify(payload)});
    assert.equal(response.status,201);const saved=await response.json() as any;
    assert.equal(saved.chunk.source,'MANUAL_ENTRY');assert.equal(saved.chunk.clientId,client.id);
    assert.deepEqual(saved.chunk.messages.map((message:any)=>message.content),['Добрый день','Уточните количество пар']);
    assert.deepEqual(saved.chunk.messages.map((message:any)=>message.sender),['CLIENT','MANAGER']);
    assert.equal(saved.chunk.messages[0].timestamp,'2026-11-11T04:38:00.000Z');
    assert.equal(await prisma.deal.count({where:{clientId:client.id}}),0);
    response=await call(route,{method:'POST',headers:{Cookie:cookie},body:JSON.stringify(payload)});
    assert.equal(response.status,200);assert.equal((await response.json() as any).duplicate,true);
    assert.equal(await prisma.conversationChunk.count({where:{clientId:client.id}}),1);
    const invalid={...payload,requestId:randomUUID(),messages:[{sender:'SYSTEM',content:'forged'}]};
    assert.equal((await call(route,{method:'POST',headers:{Cookie:cookie},body:JSON.stringify(invalid)})).status,400);
    assert.equal(await prisma.conversationChunk.count({where:{clientId:client.id}}),1);
  }finally{geminiService.parseTextDialogue=original;await deleteClientCompletely(client.id);}
});
test('AI continues the merged dialogue and uses published rates without inventing a total',async()=>{
  const client=await prisma.client.create({data:{name:'Continuation fixture',category:'CLOTHES',aiSummary:'Старая сводка: ассортимент необходимо уточнить'}});
  const old=geminiService.generateReply;let seen:any,calls=0;
  geminiService.generateReply=async options=>{seen=options;calls++;return {reply:'Добрый день! Понял, подготовим предварительный состав работ после оценки объёма партии.',explanation:'Контекст учтён.',variations:['Здравствуйте! Можно начать с ориентировочного объёма партии.']};};
  try{
    const now=Date.now();
    await prisma.conversationChunk.create({data:{clientId:client.id,source:'TELEGRAM_BOT',createdAt:new Date(now-3000),messages:{create:[{sender:'CLIENT',content:'Здравствуйте!',position:0,originalTime:'17:21'},{sender:'CLIENT',content:'Нужны все услуги маркировки на аутсорсинге на СВХ',position:1,originalTime:'17:22'}]}}});
    await prisma.conversationChunk.create({data:{clientId:client.id,source:'TELEGRAM_BOT',createdAt:new Date(now-2000),messages:{create:[{sender:'CLIENT',content:'Здравствуйте!',position:0,originalTime:'17:21'},{sender:'CLIENT',content:'Нужны все услуги маркировки на аутсорсинге на СВХ',position:1,originalTime:'17:22'},{sender:'MANAGER',content:'Уточните ассортимент и коды ТН ВЭД',position:2}]}}});
    await prisma.conversationChunk.create({data:{clientId:client.id,source:'MANUAL_ENTRY',createdAt:new Date(now-1000),messages:{create:[{sender:'CLIENT',content:'Точный ассортимент пока не могу подсказать. Коды ТН ВЭД пока не могу подсказать. Можно подготовить предварительное КП?',position:0}]}}});
    const reply=await aiOrchestrator.generateSuggestedReply({clientId:client.id,provider:'GEMINI'});
    assert.equal(reply.context.messageCount,4);
    assert.equal(seen.recentMessages.length,4);
    assert(seen.recentMessages.at(-1).content.includes('предварительное КП'));
    assert(seen.knowledgeContext.includes('Не требуй эти данные повторно'));
    assert(seen.knowledgeContext.includes('клиенту нужен полный аутсорсинг'));
    assert(seen.knowledgeContext.includes('спроси только ориентировочное количество'));
    assert(!reply.reply.startsWith('Добрый день'));
    assert(!reply.variations[0].startsWith('Здравствуйте'));
    await loadPricing({force:true,fetcher:async()=>new Response(JSON.stringify({tariffs:[
      {code:'DIGITAL',priceRetail:6,priceWholesale:5,priceLargeWholesale:4},
      {code:'PRINT',priceRetail:18,priceWholesale:16,priceLargeWholesale:13},
      {code:'STANDARD',priceRetail:42,priceWholesale:39,priceLargeWholesale:32},
      {code:'PRO',priceRetail:72,priceWholesale:65,priceLargeWholesale:55}],
      pricingSettings:{volumeTier1:5000,volumeTier2:25000,ssccPrice:50,stickerLayoutPrice:5000,selfLayoutPrice:1000,urgentPercent:25,expressDeliveryPrice:15000,outsourcingOneTimePrice:79900,cardNktPrice:150,cardMptPrice:200,cardFullPackagePrice:300}}))});
    const offer=await aiOrchestrator.generateSuggestedReply({clientId:client.id,provider:'GEMINI',intent:'COMMERCIAL_OFFER'});
    assert.equal(offer.intent,'COMMERCIAL_OFFER');assert.equal(offer.pricedOffer,false);
    assert.equal(calls,1);
    assert.equal(offer.provider,'SERVER_TEMPLATE');
    assert(offer.reply.includes('Задача клиента'));
    assert(offer.reply.includes('Опубликованные цены TANBOX'));
    assert(offer.reply.includes('42 ₸/ед.'));
    assert(offer.reply.includes('Итоговая сумма пока не рассчитана'));
    assert(offer.reply.includes('полный аутсорсинг'));
    assert.equal((await prisma.aISuggestion.findFirstOrThrow({where:{id:offer.suggestionId}})).promptType,'COMMERCIAL_OFFER');
  }finally{geminiService.generateReply=old;await deleteClientCompletely(client.id);}
});
test('AI draft chat keeps corrections per client and rejects stale or foreign drafts',async()=>{
  const client=await prisma.client.create({data:{name:'Draft chat client',category:'CLOTHES',conversations:{create:{messages:{create:{sender:'CLIENT',content:'Нужно коммерческое предложение по одежде.',position:0}}}}}});
  const other=await prisma.client.create({data:{name:'Other draft owner'}});
  const base=await prisma.aISuggestion.create({data:{clientId:client.id,provider:'GEMINI',promptType:'REPLY_SUGGESTION',suggestedText:'Добрый день! Подготовим предварительный ответ.',query:'Первый ответ'}});
  const original=geminiService.generateReply;
  let seenPrompt='';
  geminiService.generateReply=async options=>{seenPrompt=options.userPrompt||'';return {reply:'Добрый день! Подготовим короткий ответ без лишних вопросов.',explanation:'Учтена просьба менеджера.',variations:[]};};
  try{
    const list='/api/ai/draft-chat?clientId='+client.id+'&intent=REPLY';
    assert.equal((await call(list)).status,401);
    const initial=await call(list,{headers:{Cookie:cookie}});
    assert.equal(initial.status,200);
    assert.equal(((await initial.json()) as any).entries.length,1);
    const body={clientId:client.id,suggestionId:base.id,instruction:'Сократи текст и убери приветствие.'};
    const foreign=await call('/api/ai/draft-chat/revise',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({...body,clientId:other.id})});
    assert.equal(foreign.status,404);
    const edited=await call('/api/ai/draft-chat/revise',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify(body)});
    assert.equal(edited.status,200);
    const result=(await edited.json() as any).suggestion;
    assert(!result.reply.startsWith('Добрый день'));
    assert(seenPrompt.includes('Сократи текст и убери приветствие'));
    assert(seenPrompt.includes('Подготовим предварительный ответ'));
    const history=(await (await call(list,{headers:{Cookie:cookie}})).json() as any).entries;
    assert.equal(history.length,2);
    assert.equal(history[1].query,body.instruction);
    assert.equal(history[1].suggestedText,result.reply);
    const stale=await call('/api/ai/draft-chat/revise',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify(body)});
    assert.equal(stale.status,409);
  }finally{geminiService.generateReply=original;await deleteClientCompletely(client.id);await deleteClientCompletely(other.id);}
});
test('Telegram screenshot review survives in database, saves corrections and removes expired drafts',async()=>{
  const original=geminiService.parseScreenshotsBatch;
  geminiService.parseScreenshotsBatch=async()=>({clientName:'Telegram review client',category:'OTHER',sentiment:'NEUTRAL',summary:'Original summary',nextStep:'Call',messages:[{sender:'MANAGER',content:'Добрый день',time:'09:38'}]});
  try{
    const image=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer();
    const images=await prepareImages([{buffer:image,mimeType:'image/png'}]);
    const before=await prisma.client.count();
    const preview=await aiOrchestrator.previewScreenshots({images,source:'TELEGRAM_BOT'});
    assert(!preview.duplicate&&preview.parsed&&preview.reviewToken);
    const draft=await createTelegramScreenshotDraft(approved,images,preview.parsed,preview.reviewToken);
    assert.equal(await prisma.client.count(),before);
    await updateTelegramScreenshotDraft(draft.id,approved,parsed=>({...parsed,summary:'Corrected summary',messages:[{...parsed.messages[0],sender:'CLIENT',content:'Здравствуйте'}]}));
    const result=await commitTelegramScreenshotDraft(draft.id,approved);
    assert.equal(result.chunk.source,'TELEGRAM_BOT');
    assert.equal(result.chunk.messages[0].sender,'CLIENT');
    assert.equal(result.chunk.messages[0].content,'Здравствуйте');
    assert.equal(result.client.aiSummary,'Corrected summary');
    assert.equal(await prisma.screenshotDraft.count({where:{id:draft.id}}),0);
    await deleteClientCompletely(result.client.id);
    const second=await prepareImages([{buffer:image,mimeType:'image/png'}]);
    const other=await aiOrchestrator.previewScreenshots({images:second,source:'TELEGRAM_BOT'});
    assert(!other.duplicate&&other.parsed&&other.reviewToken);
    const expired=await createTelegramScreenshotDraft(approved,second,other.parsed,other.reviewToken);
    await prisma.screenshotDraft.update({where:{id:expired.id},data:{expiresAt:new Date(Date.now()-1000)}});
    await cleanupExpiredScreenshotDrafts();
    assert.equal(await prisma.screenshotDraft.count({where:{id:expired.id}}),0);
    await assert.rejects(readFile(path.join(directory,path.basename(second[0].url))));
  }finally{geminiService.parseScreenshotsBatch=original;}
});
test('Telegram review buttons edit sender and text before confirmation',async()=>{
  const transport=Telegram.prototype.callApi,original=geminiService.parseScreenshotsBatch;
  const sent:any[]=[];Telegram.prototype.callApi=async function(method,payload:any){if(method==='sendMessage')sent.push(payload);return {message_id:1} as any;};
  geminiService.parseScreenshotsBatch=async()=>({clientName:'Telegram buttons client',category:'OTHER',sentiment:'NEUTRAL',summary:'Test',nextStep:'Call',messages:[{sender:'MANAGER',content:'Wrong author'}]});
  const service=new TelegramBotService() as any;service.bot.botInfo={id:123456789,is_bot:true,first_name:'Test',username:'test_bot'};
  let update=500;
  const action=async(data:string)=>{service.userRequests.clear();await service.bot.handleUpdate({update_id:++update,callback_query:{id:String(update),from:{id:Number(approved),is_bot:false,first_name:'Owner'},chat_instance:'test',data,message:{message_id:1,date:0,chat:{id:Number(approved),type:'private'},text:'Draft'}}});};
  const sendText=async(value:string)=>{service.userRequests.clear();await service.bot.handleUpdate({update_id:++update,message:{message_id:update,date:0,from:{id:Number(approved),is_bot:false,first_name:'Owner'},chat:{id:Number(approved),type:'private'},text:value}});};
  try{
    const image=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();
    const images=await prepareImages([{buffer:image,mimeType:'image/png'}]);
    const preview=await aiOrchestrator.previewScreenshots({images,source:'TELEGRAM_BOT'});assert(!preview.duplicate&&preview.parsed&&preview.reviewToken);
    const draft=await createTelegramScreenshotDraft(approved,images,preview.parsed,preview.reviewToken);
    await action('sr:msg:'+draft.id+':0');assert(sent.at(-1).text.includes('Wrong author'));
    await action('sr:role:'+draft.id+':0:C');
    await action('sr:text:'+draft.id+':0');await sendText('Добрый день');
    const corrected=await prisma.screenshotDraft.findUniqueOrThrow({where:{id:draft.id}});
    assert.equal((corrected.parsed as any).messages[0].sender,'CLIENT');
    assert.equal((corrected.parsed as any).messages[0].content,'Добрый день');
    await action('sr:save:'+draft.id);
    const client=await prisma.client.findFirstOrThrow({where:{name:'Telegram buttons client'},include:{conversations:{include:{messages:true}}}});
    assert.equal(client.conversations[0].messages[0].sender,'CLIENT');
    await deleteClientCompletely(client.id);
  }finally{Telegram.prototype.callApi=transport;geminiService.parseScreenshotsBatch=original;}
});
test('AI failure leaves no partial client; retries deduplicate and create one deal',async()=>{
  const original=geminiService.parseTextDialogue;
  const count=await prisma.client.count();
  geminiService.parseTextDialogue=async()=>{throw new Error('simulated provider failure');};
  await assert.rejects(aiOrchestrator.ingestTextDialogue({rawText:'fail'}));
  assert.equal(await prisma.client.count(),count);
  geminiService.parseTextDialogue=async()=>({clientName:'Unique import',category:'OTHER',sentiment:'NEUTRAL',summary:'Test',nextStep:'Call',messages:[{sender:'CLIENT',content:'Hi'}]});
  try{
    const a=await aiOrchestrator.ingestTextDialogue({rawText:'same import'});
    const b=await aiOrchestrator.ingestTextDialogue({rawText:'same import'});
    assert.equal(a.client.id,b.client.id);assert(b.duplicate);
    assert.equal(await prisma.deal.count({where:{clientId:a.client.id}}),1);
    const old=await prisma.client.count();
    geminiService.parseTextDialogue=async()=>({clientName:'Must rollback',category:'OTHER',sentiment:'NEUTRAL',summary:'Test',nextStep:'Call',messages:[{sender:'CLIENT',content:'bad',senderName:{} as any}]});
    await assert.rejects(aiOrchestrator.ingestTextDialogue({rawText:'invalid db data'}));
    assert.equal(await prisma.client.count(),old);
  }finally{geminiService.parseTextDialogue=original;}
});
test('imports from overlapping conversations save only new messages, including across sources',async()=>{
  const original=geminiService.parseTextDialogue;
  const a={sender:'CLIENT' as const,content:'Please prepare a complete commercial offer for clothes',time:'17:21'};
  const b={sender:'CLIENT' as const,content:'We need all marking services at the warehouse',time:'17:22'};
  const c={sender:'MANAGER' as const,content:'Please tell us the expected quantity',time:'17:23'};
  const sequences:Record<string,Array<{sender:'CLIENT'|'MANAGER';content:string;time:string}>>={first:[a,b],second:[a,b,c],again:[a,b,c],afterManual:[a,b]};
  geminiService.parseTextDialogue=async rawText=>({clientName:'Overlap import',category:'CLOTHES',sentiment:'NEUTRAL',summary:'Test',nextStep:'Reply',messages:sequences[rawText]});
  try{
    const first=await aiOrchestrator.ingestTextDialogue({rawText:'first',source:'WEB_PANEL'});
    const second=await aiOrchestrator.ingestTextDialogue({rawText:'second',source:'TELEGRAM_BOT',targetClientId:first.client.id});
    assert.equal(second.duplicate,false);
    assert.equal(second.overlapRemoved,2);
    assert.deepEqual(second.chunk.messages.map(m=>m.content),[c.content]);
    const repeated=await aiOrchestrator.ingestTextDialogue({rawText:'again',source:'WEB_PANEL',targetClientId:first.client.id});
    assert.equal(repeated.duplicate,true);
    assert.equal(repeated.overlapRemoved,3);
    assert.equal(await prisma.conversationChunk.count({where:{clientId:first.client.id}}),2);
    assert.equal(await prisma.message.count({where:{chunk:{clientId:first.client.id}}}),3);
    await prisma.conversationChunk.create({data:{clientId:first.client.id,source:'MANUAL',messages:{create:{sender:'CLIENT',content:'I will send the assortment later',position:0}}}});
    const olderCopy=await aiOrchestrator.ingestTextDialogue({rawText:'afterManual',source:'WEB_PANEL',targetClientId:first.client.id});
    assert.equal(olderCopy.duplicate,true);
    assert.equal(await prisma.message.count({where:{chunk:{clientId:first.client.id}}}),4);
    await deleteClientCompletely(first.client.id);
  }finally{geminiService.parseTextDialogue=original;}
});
test('client deletion cascades all data and physically removes every private screenshot',async()=>{
  const filenames=[1,2].map(()=> 'screenshot-'+randomUUID()+'.jpg');
  for(const filename of filenames)await writeFile(path.join(directory,filename),Buffer.from('private image'));
  const otherFile='screenshot-'+randomUUID()+'.jpg';await writeFile(path.join(directory,otherFile),Buffer.from('other owner'));
  const other=await prisma.client.create({data:{name:'Other owner',conversations:{create:{screenshotUrl:'/uploads/'+otherFile}}}});
  const client=await prisma.client.create({data:{name:'Delete me',conversations:{create:{screenshotUrl:filenames.map(f=>'/uploads/'+f).join(','),messages:{create:[{sender:'CLIENT',content:'Private text',position:0}]}}},deals:{create:{title:'Private order'}},aiSuggestions:{create:{provider:'GEMINI',promptType:'REPLY_SUGGESTION',suggestedText:'Private suggestion'}}}});
  const response=await call('/api/clients/'+client.id,{method:'DELETE',headers:{Cookie:cookie}});
  assert.equal(response.status,200);const result=await response.json() as any;assert.equal(result.cleanupPending,0);
  assert.equal(result.deleted.messages,1);assert.equal(result.deleted.conversations,1);assert.equal(result.deleted.deals,1);assert.equal(result.deleted.aiSuggestions,1);
  assert.equal(await prisma.client.count({where:{id:client.id}}),0);
  assert.equal(await prisma.message.count({where:{chunk:{clientId:client.id}}}),0);
  for(const filename of filenames){await assert.rejects(readFile(path.join(directory,filename)));assert.equal((await call('/uploads/'+filename,{headers:{Cookie:cookie}})).status,404);}
  assert.equal((await readFile(path.join(directory,otherFile))).toString(),'other owner');
  assert.equal((await call('/api/clients/'+client.id,{method:'DELETE',headers:{Cookie:cookie}})).status,200);
  await call('/api/clients/'+other.id,{method:'DELETE',headers:{Cookie:cookie}});
});
test('failed physical cleanup remains queued and inaccessible until retried',async()=>{
  const filename='screenshot-'+randomUUID()+'.jpg',file=path.join(directory,filename);
  await mkdir(file); // unlink must fail deterministically on both Windows and Linux.
  const client=await prisma.client.create({data:{name:'Retry cleanup',conversations:{create:{screenshotUrl:'/uploads/'+filename}}}});
  const response=await call('/api/clients/'+client.id,{method:'DELETE',headers:{Cookie:cookie}});
  assert.equal(response.status,202);assert.equal(((await response.json()) as any).cleanupPending,1);
  assert.equal(await prisma.fileDeletion.count({where:{filename}}),1);
  const retry=await call('/api/clients/'+client.id,{method:'DELETE',headers:{Cookie:cookie}});
  assert.equal(retry.status,202);assert.equal(((await retry.json()) as any).cleanupPending,1);
  assert.equal((await call('/uploads/'+filename,{headers:{Cookie:cookie}})).status,404);
  await rmdir(file);await writeFile(file,'retry');
  await flushFileDeletions([filename]);
  await assert.rejects(readFile(file));assert.equal(await prisma.fileDeletion.count({where:{filename}}),0);
});
test('messages created at the same instant retain their imported sequence in every API',async()=>{
  const original=geminiService.parseScreenshotsBatch;
  const messages=Array.from({length:15},(_,i)=>({sender:(i%2?'MANAGER':'CLIENT') as 'MANAGER'|'CLIENT',content:'Ordered message '+i,time:i<7?'23:59':'00:01'}));
  geminiService.parseScreenshotsBatch=async()=>({clientName:'Ordered batch',category:'OTHER',sentiment:'NEUTRAL',summary:'Ordered',nextStep:'Reply',messages});
  try{
    const result=await aiOrchestrator.ingestScreenshotsBatch({images:[{buffer:Buffer.from('test 1'),mimeType:'image/png',url:''},{buffer:Buffer.from('test 2'),mimeType:'image/png',url:''}]});
    assert.deepEqual(result.chunk.messages.map(m=>m.content),messages.map(m=>m.content));
    const response=await call('/api/clients/'+result.client.id,{headers:{Cookie:cookie}});
    const card=await response.json() as any;
    assert.deepEqual(card.client.conversations[0].messages.map((m:any)=>m.content),messages.map(m=>m.content));
    assert.deepEqual(card.client.conversations[0].messages.map((m:any)=>m.position),Array.from({length:15},(_,i)=>i));
    assert.equal(card.client.conversations[0].messages[7].originalTime,'00:01');
    const endpoint=await call('/api/messages/chunk/'+result.chunk.id+'/messages',{headers:{Cookie:cookie}});
    assert.deepEqual(((await endpoint.json()) as any).messages.map((m:any)=>m.content),messages.map(m=>m.content));
  }finally{geminiService.parseScreenshotsBatch=original;}
});
test('a screenshot still referenced by another client survives until its final owner is deleted',async()=>{
  const filename='screenshot-'+randomUUID()+'.jpg';await writeFile(path.join(directory,filename),'shared');
  const a=await prisma.client.create({data:{name:'Shared A',conversations:{create:{screenshotUrl:'/uploads/'+filename}}}});
  const b=await prisma.client.create({data:{name:'Shared B',conversations:{create:{screenshotUrl:'/uploads/'+filename}}}});
  await deleteClientCompletely(a.id);assert.equal((await readFile(path.join(directory,filename))).toString(),'shared');
  await deleteClientCompletely(b.id);await assert.rejects(readFile(path.join(directory,filename)));
});
test('knowledge context reads active custom rules',async()=>{
  await prisma.knowledgeItem.create({data:{category:'FAQ',title:'Regression rule',content:'CUSTOM_RULE_ABC',reviewStatus:'APPROVED'}});
  assert((await getSystemPromptContext()).includes('CUSTOM_RULE_ABC'));
});
test('concurrent duplicate imports remain one atomic conversation',async()=>{
  const original=geminiService.parseTextDialogue;
  geminiService.parseTextDialogue=async()=>({clientName:'Race import',category:'OTHER',sentiment:'NEUTRAL',summary:'Test',nextStep:'Call',messages:[{sender:'CLIENT',content:'Hi'}]});
  try {
    const [a,b]=await Promise.all([1,2].map(()=>aiOrchestrator.ingestTextDialogue({rawText:'race duplicate'})));
    assert.equal(a.client.id,b.client.id);
    assert.equal(await prisma.conversationChunk.count({where:{clientId:a.client.id}}),1);
    assert.equal(await prisma.deal.count({where:{clientId:a.client.id}}),1);
  } finally {geminiService.parseTextDialogue=original;}
});
test('seed is idempotent and preserves existing client data',async()=>{
  const count=await prisma.client.count();
  await seedKnowledge();const rules=await prisma.knowledgeItem.count();
  await seedKnowledge();
  assert.equal(await prisma.client.count(),count);
  assert.equal(await prisma.knowledgeItem.count(),rules);
});
test('pagination limits payloads without hiding earlier messages',async()=>{
  const r=await call('/api/clients?limit=1&offset=1',{headers:{Cookie:cookie}});
  const page=await r.json() as any;assert.equal(r.status,200);assert.equal(page.clients.length,1);assert(page.total>1);
  assert.equal((await call('/api/clients?limit=0',{headers:{Cookie:cookie}})).status,400);
  const client=await prisma.client.findFirstOrThrow();
  const chunk=await prisma.conversationChunk.create({data:{clientId:client.id,messages:{create:Array.from({length:105},(_,i)=>({content:'Message '+i,sender:'CLIENT',createdAt:new Date(1700000000000+i)}))}}});
  const latest=await call('/api/messages/chunk/'+chunk.id+'/messages?limit=100',{headers:{Cookie:cookie}});
  const messages=await latest.json() as any;assert.equal(messages.total,105);assert.equal(messages.messages.length,100);
  const earlier=await call('/api/messages/chunk/'+chunk.id+'/messages?limit=100&offset=100',{headers:{Cookie:cookie}});
  assert.equal(((await earlier.json()) as any).messages.length,5);
});
test('Telegram access is checked before handlers and simultaneous images are retained',async()=>{
  const original=Telegram.prototype.callApi;const messages:string[]=[];
  Telegram.prototype.callApi=async function(_method,payload:any){messages.push(payload?.text||'');return {message_id:1} as any;};
  const service=new TelegramBotService() as any;
  service.bot.botInfo={id:123456789,is_bot:true,first_name:'Test',username:'test_bot'};
  try{
    await service.bot.handleUpdate({update_id:1,message:{message_id:1,date:0,from:{id:999999,is_bot:false,first_name:'Stranger'},chat:{id:999999,type:'private'},text:'/login',entities:[{offset:0,length:6,type:'bot_command'}]}});
    assert.equal(await prisma.adminUser.count({where:{telegramChatId:'999999'}}),0);
    assert(messages.some(m=>m.includes('не разрешён')));
    const ctx={chat:{id:Number(approved),type:'private'},from:{id:Number(approved)}};
    await Promise.all([service.enqueueImage(ctx,'one','image/jpeg'),service.enqueueImage(ctx,'two','image/jpeg')]);
    const batch=service.batches.get(approved);assert.equal(batch.files.length,2);clearTimeout(batch.timer);service.batches.clear();
  }finally{Telegram.prototype.callApi=original;}
});
test('Telegram menu retains client import, AI replies, status changes and knowledge',async()=>{
  const originalTransport=Telegram.prototype.callApi,originalParse=geminiService.parseTextDialogue,originalSuggest=aiOrchestrator.generateSuggestedReply;
  const messages:any[]=[];let suggestedFor='';
  Telegram.prototype.callApi=async function(method,payload:any){if(method==='sendMessage')messages.push(payload);return {message_id:1} as any;};
  geminiService.parseTextDialogue=async()=>({clientName:'Bot workflow client',category:'SHOES',sentiment:'NEUTRAL',summary:'Need 100 codes',nextStep:'Ask date',messages:[{sender:'CLIENT',content:'Need 100 codes'}]});
  aiOrchestrator.generateSuggestedReply=async options=>{suggestedFor=options.clientId;return {suggestionId:'test',reply:'Test reply',explanation:'Test explanation',variations:[],provider:'GEMINI'};};
  const service=new TelegramBotService() as any;service.bot.botInfo={id:123456789,is_bot:true,first_name:'Test',username:'test_bot'};
  let update=100;
  const text=async(value:string)=>{service.userRequests.clear();await service.bot.handleUpdate({update_id:++update,message:{message_id:update,date:0,from:{id:Number(approved),is_bot:false,first_name:'Owner'},chat:{id:Number(approved),type:'private'},text:value,...(value.startsWith('/')?{entities:[{offset:0,length:value.split(' ')[0].length,type:'bot_command'}]}:{})}});};
  const action=async(data:string)=>{service.userRequests.clear();await service.bot.handleUpdate({update_id:++update,callback_query:{id:String(update),from:{id:Number(approved),is_bot:false,first_name:'Owner'},chat_instance:'test',data,message:{message_id:1,date:0,chat:{id:Number(approved),type:'private'},text:'Menu'}}});};
  try{
    await text('/start');
    assert(messages.at(-1).reply_markup.keyboard.flat().some((b:any)=>b===BOT_LABELS.upload||b.text===BOT_LABELS.upload));
    await text(BOT_LABELS.upload);await text('Client: Need 100 codes');
    const client=await prisma.client.findFirstOrThrow({where:{name:'Bot workflow client'}});
    assert.equal(await prisma.deal.count({where:{clientId:client.id}}),1);
    assert(messages.at(-1).text.includes('Клиент: Bot workflow client'));
    await action('pickreply:'+client.id);assert(messages.at(-1).reply_markup.inline_keyboard.flat().some((b:any)=>b.text==='Деловой'));
      await action('price:'+client.id);assert(messages.at(-1).text.includes('Расчёт стоимости'));
    await action('ai:BUSINESS:'+client.id);assert.equal(suggestedFor,client.id);
    await action('setstatus:KP_SENT:'+client.id);assert.equal((await prisma.client.findUniqueOrThrow({where:{id:client.id}})).status,'KP_SENT');
    assert.equal((await prisma.deal.findFirstOrThrow({where:{clientId:client.id}})).stage,'OFFER_SENT');
    await action('deleteconfirm:'+client.id);assert.equal(await prisma.client.count({where:{id:client.id}}),1);
    assert(messages.at(-1).reply_markup.inline_keyboard.flat().some((b:any)=>b.text==='Удалить полностью'));
    await action('deleteclient:'+client.id);assert.equal(await prisma.client.count({where:{id:client.id}}),0);
    assert(messages.at(-1).text.includes('скриншоты удалены'));
    await text(BOT_LABELS.knowledge);assert(messages.at(-1).text.includes('База знаний'));
    await text(BOT_LABELS.pipeline);assert(messages.at(-1).text.includes('Воронка сделок'));
  }finally{Telegram.prototype.callApi=originalTransport;geminiService.parseTextDialogue=originalParse;aiOrchestrator.generateSuggestedReply=originalSuggest;}
});
test('Telegram album download order follows message IDs rather than handler arrival order',async()=>{
  const transport=Telegram.prototype.callApi,originalFetch=globalThis.fetch,originalParse=geminiService.parseScreenshotsBatch;
  Telegram.prototype.callApi=async function(method,payload:any){return method==='getFile'?{file_id:payload.file_id,file_path:payload.file_id}: {message_id:1} as any;};
  const order:string[]=[],png=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer();
  globalThis.fetch=async(input:any)=>{const url=String(input);order.push(url.split('/').pop()!);return new Response(new Uint8Array(png));};
  geminiService.parseScreenshotsBatch=async()=>({clientName:'Telegram ordered album',category:'OTHER',sentiment:'NEUTRAL',summary:'Album',nextStep:'Call',messages:[{sender:'CLIENT',content:'Album text'}]});
  const service=new TelegramBotService() as any;
  const ctx=(messageId:number)=>({from:{id:Number(approved)},chat:{id:Number(approved),type:'private'},message:{message_id:messageId},reply:async()=>({message_id:1})});
  try{
    service.enqueueImage(ctx(30),'screen-30','image/png');service.enqueueImage(ctx(20),'screen-20','image/png');
    const batch=service.batches.get(approved);clearTimeout(batch.timer);await service.processBatch(approved);
    assert.deepEqual(order,['screen-20','screen-30']);
    assert.equal(await prisma.client.count({where:{name:'Telegram ordered album'}}),0);
    const draft=await prisma.screenshotDraft.findFirstOrThrow({where:{telegramUserId:approved}});
    assert.equal((draft.parsed as any).clientName,'Telegram ordered album');
    await discardScreenshotDraft(draft.id,approved);
  }finally{Telegram.prototype.callApi=transport;globalThis.fetch=originalFetch;geminiService.parseScreenshotsBatch=originalParse;}
});
test('complete knowledge bundle stores original bytes and full category/article content without truncation',async()=>{
  const bundle=JSON.parse(await readFile(path.join(process.cwd(),'data/knowledge-bundle.json'),'utf8'));
  const report=await importArchive(bundle);
  assert.equal(report.ok,true);assert.equal(report.categories,12);assert(report.documents>100);
  assert.equal(report.sourceFiles,bundle.sources.length);assert.equal(report.contentCharacters,bundle.manifest.coverage.contentCharacters);
  const stored=await prisma.knowledgeImport.findUniqueOrThrow({where:{id:report.importId},include:{sources:true,documents:true}});
  for(const source of bundle.sources){
    const record=stored.sources.find(s=>s.path===source.path)!;
    assert.deepEqual(record.data,Buffer.from(source.data,'base64'));assert.equal(sha256(record.data),source.sha256);
  }
  for(const doc of bundle.documents){
    const record=stored.documents.find(d=>d.key===doc.key)!;
    assert.equal(record.content,doc.content);assert.deepEqual(record.payload,doc.payload);
  }
  const technical=stored.documents.find(d=>d.kind==='TECHNICAL')!;assert(technical.content.length>200000);
  const passages=await prisma.knowledgePassage.findMany({where:{documentId:technical.id},orderBy:{position:'asc'}});
  assert(passages.length>100);assert.equal(passages.map(p=>p.content).join(''),technical.content);
  assert.equal((await importArchive(bundle)).importId,report.importId);
  assert.equal(await prisma.knowledgeImport.count({where:{bundleHash:bundle.bundleHash}}),1);
});

test('knowledge rejects missing or corrupted input, and detects tampering after database storage',async()=>{
  const bundle=JSON.parse(await readFile(path.join(process.cwd(),'data/knowledge-bundle.json'),'utf8'));
  const active=await activeArchive();assert(active);
  const broken=structuredClone(bundle);broken.sources[0].data=Buffer.from('corrupted').toString('base64');
  await assert.rejects(importArchive(broken),/checksum mismatch/);
  const missing=structuredClone(bundle);missing.documents.pop();assert.throws(()=>validateBundle(missing),/Incomplete manifest/);
  assert.equal((await activeArchive())?.id,active.id);
  const source=await prisma.knowledgeSource.findFirstOrThrow({where:{importId:active.id}});
  try{
    await prisma.knowledgeSource.update({where:{id:source.id},data:{data:Buffer.from('tampered')}});
    const report=await verifyArchive(active.id);assert.equal(report.ok,false);assert(report.failures.some(f=>f.startsWith('source:')));
  }finally{await prisma.knowledgeSource.update({where:{id:source.id},data:{data:source.data}});}
  assert.equal((await verifyArchive(active.id)).ok,true);
});

test('a new knowledge version retains the entire previous import and its original metadata',async()=>{
  const bundle=JSON.parse(await readFile(path.join(process.cwd(),'data/knowledge-bundle.json'),'utf8'));
  const original=await activeArchive();assert(original);
  bundle.documents[0].title+=' (new source revision)';
  bundle.documents[0].sha256=documentDigest(bundle.documents[0]);
  bundle.bundleHash=sha256(canonical({sources:bundle.sources.map((s:any)=>({path:s.path,sha256:s.sha256})),documents:bundle.documents.map((d:any)=>({key:d.key,sha256:d.sha256})),manifest:bundle.manifest}));
  const result=await importArchive(bundle);assert.notEqual(result.importId,original.id);
  assert.equal((await verifyArchive(original.id)).ok,true);assert.equal((await verifyArchive(result.importId)).ok,true);
  const previous=await prisma.knowledgeDocument.findFirstOrThrow({where:{importId:original.id,key:bundle.documents[0].key}});
  assert.notEqual(previous.title,bundle.documents[0].title);
});

test('knowledge API protects full exports, paginates all documents and returns complete text and original source bytes',async()=>{
  const active=await activeArchive();assert(active);
  assert.equal((await call('/api/settings/knowledge/library')).status,401);
  assert.equal((await call('/api/settings/knowledge/library/export')).status,401);
  let offset=0,ids:string[]=[],total=0;
  do{
    const response=await call('/api/settings/knowledge/library?language=ALL&limit=20&offset='+offset,{headers:{Cookie:cookie}});
    assert.equal(response.status,200);const page=await response.json() as any;
    total=page.total;ids.push(...page.documents.map((d:any)=>d.id));offset+=20;
  }while(offset<total);
  assert.equal(ids.length,total);assert.equal(new Set(ids).size,total);
  const doc=await prisma.knowledgeDocument.findFirstOrThrow({where:{importId:active.id,kind:'TECHNICAL'}});
  const response=await call('/api/settings/knowledge/library/documents/'+doc.id,{headers:{Cookie:cookie}});
  const body=await response.json() as any;assert.equal(body.document.content,doc.content);
  const source=await prisma.knowledgeSource.findUniqueOrThrow({where:{id:body.document.sources[0].id}});
  assert.equal((await call('/api/settings/knowledge/library/sources/'+source.id)).status,401);
  const download=await call('/api/settings/knowledge/library/sources/'+source.id,{headers:{Cookie:cookie}});
  assert.equal(download.status,200);assert(download.headers.get('content-disposition')?.startsWith('attachment;'));
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),source.data);
  const exported=await call('/api/settings/knowledge/library/export',{headers:{Cookie:cookie}});
  assert.equal(exported.status,200);const exportedBundle=validateBundle(await exported.json());
  assert.equal(exportedBundle.bundleHash,active.bundleHash);
  const tail=doc.content.trim().split('\n').filter(Boolean).at(-1)!.slice(0,60);
  const search=await call('/api/settings/knowledge/library?search='+encodeURIComponent(tail),{headers:{Cookie:cookie}});
  const found=await search.json() as any;assert(found.documents.some((d:any)=>d.id===doc.id));
});

test('Telegram knowledge pages expose the full stored text including its final page',async()=>{
  const original=Telegram.prototype.callApi,messages:any[]=[];
  Telegram.prototype.callApi=async function(method,payload:any){if(method==='sendMessage')messages.push(payload);return {message_id:1} as any;};
  const bot=new TelegramBotService() as any;
  try{
    const ctx={from:{id:Number(approved)},chat:{id:Number(approved),type:'private'},reply:async(text:string,extra:any)=>messages.push({text,...extra})};
    await bot.knowledge(ctx);assert(messages.at(-1).text.includes('полные материалы'));
    assert.equal(messages.at(-1).reply_markup.inline_keyboard.filter((row:any[])=>row.some(b=>String(b.callback_data).startsWith('kdocs:'))).length,13);
    const active=await activeArchive();const doc=await prisma.knowledgeDocument.findFirstOrThrow({where:{importId:active!.id,kind:'TECHNICAL'}});
    const {splitPassages}=await import('../src/knowledge/archive.service');
    const pages=splitPassages(doc.content,2800);
    await bot.libraryDocument(ctx,doc.id,pages.length-1);
    assert(messages.at(-1).text.endsWith(pages.at(-1)));assert(messages.at(-1).text.length<=4096);
  }finally{Telegram.prototype.callApi=original;}
});

test('CSRF and logout revoke access immediately',async()=>{
  const cross=await call('/api/clients',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.invalid'},body:'{}'});
  assert.equal(cross.status,403);
  // Avoid spending the login limiter budget on unrelated auth calls.
  await prisma.authCode.deleteMany({where:{isUsed:true}});
  const logout=await call('/api/auth/logout',{method:'POST',headers:{Cookie:cookie},body:'{}'});
  assert.equal(logout.status,200);
  assert.equal(await prisma.authSession.count(),0);
  assert.equal((await call('/api/clients',{headers:{Cookie:cookie}})).status,401);
});

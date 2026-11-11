import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import type {Server} from 'node:http';
import {prisma} from '../src/config/db';
import {env} from '../src/config/env';
import {createApp} from '../src/app';
import {sha256} from '../src/knowledge/archive.service';
import {approvedUrl,extractHtml,extractAdiletApi,type Capture} from '../src/knowledge/web.fetch';
import {discoverSources} from '../src/knowledge/web.discovery';
import {saveWebCapture,publishFact,usableFacts,recordWebFailure,webOverview} from '../src/knowledge/web.service';
import {knowledgeForReply,searchWebPassages,identifyCategory,inferTopic,dateForKazakhstan} from '../src/knowledge/web.retrieval';
import {parseMarkingListHtml,findMarkingListRows} from '../src/knowledge/web.list';
import {isSupportingTechnicalSource,asksForTechnicalStandards,sharedOperatorDocumentIds} from '../src/knowledge/web.scope';
import {aiOrchestrator} from '../src/ai/ai.orchestrator';
import {geminiService} from '../src/ai/gemini.service';
import {getSystemPromptContext} from '../src/ai/knowledge.service';
const key=randomUUID(),url='https://www.gov.kz/knowledge-test/'+key;
const seed={url,title:'Проверяемый тестовый источник',authority:'LAW',categoryCodes:['shoes'],topics:['dates','applicability'],depth:0,priority:1,intervalHours:24,language:'ru'};
const quote='Тестовое условие применяется только к указанной продукции и при подтверждённых датах партии; точный состав необходимо проверить.';
const text='Дата скачивания 10.11.2026\n'+quote+'\n'+('Полный материал для проверки сохранения сведений.\n'.repeat(2000))+'\nиспытательныйсентинел';
function capture(content=text):Capture{const data=Buffer.from('<html><body>'+content+'</body></html>');return {url,finalUrl:url,status:200,contentType:'text/html',data,sha256:sha256(data),text:content,title:seed.title,quality:'FULLTEXT',metadata:{links:[]}};}
let server:Server,origin:string,cookie:string,sessionId:string,clientId:string,revisionId:string,factId:string;
before(async()=>{
  if(!process.env.CRM_TEST_DATABASE)throw Error('Use the isolated runner');
  await prisma.adminUser.createMany({data:[{telegramChatId:'8563274673'}],skipDuplicates:true});
  const user=await prisma.adminUser.findUniqueOrThrow({where:{telegramChatId:'8563274673'}});
  const session=await prisma.authSession.create({data:{userId:user.id,expiresAt:new Date(Date.now()+60000)}});sessionId=session.id;
  cookie='tanbox_session='+jwt.sign({sub:user.id,jti:session.id},env.JWT_SECRET,{issuer:'tanbox-crm',audience:'tanbox-web',expiresIn:'1m'});
  server=await new Promise<Server>(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});origin='http://127.0.0.1:'+(server.address() as any).port;
  await prisma.webKnowledgeCategory.upsert({where:{code:'shoes'},create:{code:'shoes',title:'Обувь',aliases:['обувь','обуви','SHOES']},update:{}});
});
after(async()=>{
  await prisma.webKnowledgeFact.deleteMany({where:{key:{startsWith:key}}});
  await prisma.webKnowledgeSource.deleteMany({where:{url}});
  if(clientId)await prisma.client.deleteMany({where:{id:clientId}});
  await prisma.authSession.deleteMany({where:{id:sessionId}});
  await new Promise<void>(r=>server.close(()=>r()));await prisma.$disconnect();
});
test('web collector accepts only approved HTTPS origins and flags JavaScript shells',()=>{
  assert.equal(isSupportingTechnicalSource({url:'https://docs.eaeunion.org/upload/iblock/example.pdf',discoveredFrom:'https://docs.eaeunion.org/documents/277/9116/'}),true);
  assert.equal(isSupportingTechnicalSource({url:'https://docs.eaeunion.org/upload/iblock/example.pdf',discoveredFrom:'https://tanba.telecom.kz/ru/business/product/shoes'}),false);
  assert.equal(asksForTechnicalStandards('Какие ГОСТы и технический регламент применяются?'),true);
  assert.equal(asksForTechnicalStandards('Когда маркировать обувь?'),false);
  const shared=sharedOperatorDocumentIds([
    {id:'a',authority:'OPERATOR',categoryCodes:['shoes'],currentRevisionId:'1'},
    {id:'b',authority:'OPERATOR',categoryCodes:['tobacco'],currentRevisionId:'2'},
    {id:'c',authority:'LAW',categoryCodes:['textile'],currentRevisionId:'3'},
    {id:'d',authority:'OPERATOR',categoryCodes:['bad'],currentRevisionId:'4'},
  ],[
    {id:'1',sha256:'same-manual'},{id:'2',sha256:'same-manual'},
    {id:'3',sha256:'same-manual'},{id:'4',sha256:'different'},
  ]);
  assert.deepEqual([...shared].sort(),['a','b']);
  assert.equal(dateForKazakhstan(new Date('2026-11-10T22:30:00Z')),'2026-11-11');
  assert.equal(dateForKazakhstan(new Date('2026-11-10T18:30:00Z')),'2026-11-10');
  assert.equal(inferTopic('Как проходит модерация карточек БАД?'),'registration');
  assert.equal(inferTopic('Когда надо зарегистрироваться в ИС МПТ для оборота обуви?'),'registration');
  assert.equal(inferTopic('Как импортировать БАД до ввоза в Казахстан?'),'customs');
  assert.equal(inferTopic('Кто регистрирует карточку БАД, производитель или импортер?'),'registration');
  assert.equal(inferTopic('Заказали коды маркировки текстиля, когда их надо нанести?'),'codes');
  const badPage=extractHtml(Buffer.from('<main><p>'+('Описание маркировки и регистрации товаров. '.repeat(12))+'С 1 февраля 2026 года. С 1 сентября 2026 года.</p></main>'),'https://tanba.telecom.kz/ru/business/product/supplements');
  assert.equal(badPage.quality,'NEEDS_REVIEW');
  const adiletUrl='https://adilet.zan.kz/rus/docs/V2600039858';
  const document={group_number:'V2600039858',language:'rus',is_stub:false,has_content:true,is_actual:true,title_ru:'Проверяемый акт',text_content:'<article><p>'+quote.repeat(5)+'</p></article>'};
  const api={url:'https://adilet.zan.kz/api/documents/by-ngr/V2600039858?language=rus',status:200,contentType:'application/json',data:Buffer.from(JSON.stringify({document}))};
  const accepted=extractAdiletApi(adiletUrl,api);
  assert.equal(accepted?.quality,'FULLTEXT');assert.deepEqual(accepted?.data,api.data);
  assert.equal(extractAdiletApi(adiletUrl,{...api,data:Buffer.from(JSON.stringify({document:{...document,group_number:'V2600039487'}}))}),null);
  assert.equal(extractAdiletApi(adiletUrl,{...api,data:Buffer.from(JSON.stringify({document:{...document,is_actual:false}}))}),null);
  for(const u of ['http://www.gov.kz/a','https://127.0.0.1/a','https://www.gov.kz@localhost/a','https://evil.example/a','https://www.gov.kz:5055/a'])assert.throws(()=>approvedUrl(u));
  assert.equal(approvedUrl(url+'#secret'),url);
  assert.equal(extractHtml(Buffer.from('<html><body>Включите JavaScript</body></html>'),url).quality,'NEEDS_BROWSER');
  const parsed=extractHtml(Buffer.from('<html><head><title>Норма</title></head><body><main><h1>Тестовый документ</h1><p>'+quote.repeat(4)+'</p></main><script>DO_NOT_EXECUTE</script></body></html>'),url);
  assert(parsed.text.includes(quote));assert(!parsed.text.includes('DO_NOT_EXECUTE'));
  assert.equal(discoverSources(seed,[{url:'https://evil.example/f.pdf',title:'law'},{url:'https://www.gov.kz/uploads/law.pdf',title:'Норма'}]).length,1);
});
test('official list lookup preserves merged products and never infers applicability from a code alone',()=>{
  const rows=Array.from({length:49},(_,i)=>`<tr><td>${i+1}.</td><td>${i===30?'из 3304, 3305':'6401'}</td><td>Товар ${i+1}</td><td>Дата и исключения для позиции ${i+1}</td></tr>`).join('');
  const html=`<table><tr><th>ТН ВЭД ЕАЭС</th><th>Дата введения</th></tr>${rows}<tr><td rowspan="2">50.</td><td rowspan="2">из 2106 90 980 8</td><td>Чай</td><td>Ограничение для чая</td></tr><tr><td>Какао</td><td>Другое ограничение для какао</td></tr></table>`;
  const parsed=parseMarkingListHtml(html);
  assert.equal(parsed.length,51);
  const shared=findMarkingListRows(parsed,'2106 90 980 8');
  assert.equal(shared.rows.filter(row=>row.number==='50').length,2);
  assert.notEqual(shared.rows[0].requirement,shared.rows[1].requirement);
  assert(findMarkingListRows(parsed,'3304').rows.some(row=>row.number==='31'&&row.partialCode));
  assert.equal(findMarkingListRows(parsed,'2201').total,0);
  assert.throws(()=>findMarkingListRows(parsed,'6401 OR 1=1'));
});
test('web capture stores every byte and character, deduplicates and indexes the end of a long document',async()=>{
  await prisma.webKnowledgeCategory.upsert({where:{code:'bad'},create:{code:'bad',title:'БАД',aliases:['БАД']},update:{}});
  assert.equal(await identifyCategory('Нужна маркировка БАД?'),'bad');
  assert.equal(await identifyCategory('Правила для БАДов'),'bad');
  assert.notEqual(await identifyCategory('Маркировка бадминтонных ракеток'),'bad');
  const result=await saveWebCapture(seed,capture());revisionId=result.revisionId;
  assert.equal((await saveWebCapture(seed,capture())).revisionId,revisionId);
  const saved=await prisma.webKnowledgeRevision.findUniqueOrThrow({where:{id:revisionId},include:{passages:{orderBy:{position:'asc'}}}});
  assert.deepEqual(saved.data,capture().data);assert.equal(saved.text,text);assert.equal(saved.passages.map(p=>p.content).join(''),text);
  const found=await searchWebPassages('испытательныйсентинел','shoes');assert(found.some(p=>p.revisionId===revisionId&&p.quality==='FULLTEXT'));
  assert.equal((await knowledgeForReply({query:'Когда маркировать обувь?',category:'SHOES'})).evidence.length,0);
  const invalid=capture();invalid.sha256='0'.repeat(64);await assert.rejects(saveWebCapture(seed,invalid),/CHECKSUM/);
});
test('publishing requires exact evidence from the current full source, including conditions',async()=>{
  const fields={key:key+'-dates',title:'Обувь: сроки',answer:'Проверить даты партии и условия.',categoryCodes:['shoes'],topic:'dates',keywords:['обувь','когда'],conditions:{onlySpecifiedProducts:true},reviewedBy:'isolated-test',reviewDueAt:new Date(Date.now()+86400000)};
  await assert.rejects(publishFact({...fields,evidence:[]}),/EVIDENCE/);
  await assert.rejects(publishFact({...fields,evidence:[{revisionId,quote:'Несуществующее утверждение, которого точно нет в этом исходном тексте документа.',locator:'test'}]}),/QUOTE/);
  const fact=await publishFact({...fields,evidence:[{revisionId,quote,locator:'Тестовый пункт'}]});factId=fact.id;
  const knowledge=await knowledgeForReply({query:'Когда маркировать обувь?',category:'SHOES'});
  assert(knowledge.evidence.some(e=>e.factId===factId));assert(knowledge.context.includes('onlySpecifiedProducts'));
  await prisma.webKnowledgeCategory.upsert({where:{code:'GENERAL'},create:{code:'GENERAL',title:'Общие',aliases:['общие']},update:{}});
  await publishFact({...fields,key:key+'-general',categoryCodes:['GENERAL'],topic:'applicability',evidence:[{revisionId,quote,locator:'Тестовый пункт'}]});
  const overview=await webOverview();
  assert.equal(overview.matrix.find(c=>c.code==='shoes')?.topics.find(t=>t.topic==='applicability')?.reviewed,0);
  assert.equal(overview.matrix.find(c=>c.code==='GENERAL')?.topics.find(t=>t.topic==='applicability')?.reviewed,1);
  await recordWebFailure(seed,'SOURCE_TIMEOUT');
  const afterFailure=await prisma.webKnowledgeSource.findUniqueOrThrow({where:{url}});
  assert.equal(afterFailure.status,'READY');
  assert.equal(afterFailure.currentRevisionId,revisionId);
  assert((await usableFacts()).some(f=>f.id===fact.id));
});
test('AI receives selected reviewed knowledge and saves the exact evidence used',async()=>{
  const client=await prisma.client.create({data:{name:'Knowledge isolated client',category:'SHOES'}});clientId=client.id;
  const original=geminiService.generateReply;let context='';
  geminiService.generateReply=async options=>{context=options.knowledgeContext||'';return {reply:'Уточним даты вашей партии.',explanation:'Учитываем условия.',variations:[]};};
  try{
    const result=await aiOrchestrator.generateSuggestedReply({clientId,provider:'GEMINI',userPrompt:'Когда маркировать обувь?'});
    assert(context.includes(quote));assert(context.includes('ПОДСКАЗКИ ДЛЯ ВЕДЕНИЯ ДИАЛОГА TANBOX'));assert(context.includes('не более двух'));assert(result.evidence.some(e=>e.factId===factId));
    const suggestion=await prisma.aISuggestion.findUniqueOrThrow({where:{id:result.suggestionId}});assert((suggestion.knowledgeEvidence as any[]).some(e=>e.factId===factId));
  }finally{geminiService.generateReply=original;}
});
test('semantic change suspends old facts and unsupported legal questions bypass the model',async()=>{
  const changed=await saveWebCapture(seed,capture(text+'\nИзменены применимые условия.'));
  assert.notEqual(changed.revisionId,revisionId);assert.equal((await prisma.webKnowledgeFact.findUniqueOrThrow({where:{id:factId}})).status,'RECHECK');
  assert(!(await usableFacts()).some(f=>f.id===factId));
  const stale=await saveWebCapture(seed,capture(text+'\nСтарая редакция из повторного импорта.'),new Date(Date.now()-86400000));
  assert(await prisma.webKnowledgeRevision.findUnique({where:{id:stale.revisionId}}));
  await recordWebFailure(seed,'OLD_ERROR',new Date(Date.now()-86400000));
  const current=await prisma.webKnowledgeSource.findUniqueOrThrow({where:{url}});
  assert.equal(current.currentRevisionId,changed.revisionId);assert.equal(current.status,'READY');
  const original=geminiService.generateReply;let invoked=false;
  geminiService.generateReply=async()=>{invoked=true;throw Error('Must not call');};
  try{
    const response=await aiOrchestrator.generateSuggestedReply({clientId,provider:'GEMINI',userPrompt:'Какой штраф за отсутствие маркировки обуви?'});
    assert.equal(response.provider,'KNOWLEDGE_GUARD');assert.equal(invoked,false);assert(response.reply.includes('проверить'));
  }finally{geminiService.generateReply=original;}
});
test('web document endpoints require authentication and preserve original downloads and historical revisions',async()=>{
  assert.equal((await fetch(origin+'/api/settings/knowledge/web')).status,401);
  assert.equal((await fetch(origin+'/api/settings/knowledge/web/list-lookup?code=6401')).status,401);
  const response=await fetch(origin+'/api/settings/knowledge/web/documents/'+revisionId,{headers:{Cookie:cookie}});
  assert.equal(response.status,200);const body=await response.json() as any;assert.equal(body.integrity,true);assert.equal(body.document.text,text);
  const raw=await fetch(origin+'/api/settings/knowledge/web/documents/'+revisionId+'/raw',{headers:{Cookie:cookie}});
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()),capture().data);
  assert.equal((await fetch(origin+'/api/settings/knowledge/web/documents/'+randomUUID(),{headers:{Cookie:cookie}})).status,404);
});
test('unreviewed legacy rules never enter the AI context',async()=>{
  const rule=await prisma.knowledgeItem.create({data:{category:'FAQ',title:'Unsafe draft',content:'UNREVIEWED_MARKER_'+key}});
  try{const context=await getSystemPromptContext();assert(!context.includes('UNREVIEWED_MARKER_'+key));assert(!context.includes('Asl Belgisi'));assert(!context.includes('50 до 500'));}
  finally{await prisma.knowledgeItem.delete({where:{id:rule.id}});}
});

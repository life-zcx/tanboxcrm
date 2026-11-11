import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type {Server} from 'node:http';
import {prisma} from '../src/config/db';
import {env} from '../src/config/env';
import {createApp} from '../src/app';
import {calculateQuote,pricingSchema} from '../src/pricing/calculation';
import {loadPricing,PRICING_KEY,quoteForReply,saveQuote} from '../src/pricing/pricing.service';
import {aiOrchestrator} from '../src/ai/ai.orchestrator';
import {inferAutomaticQuote,publishedTariffGuide} from '../src/ai/auto-commercial';
import {geminiService} from '../src/ai/gemini.service';
import {validateReplyPrices,withQuoteConditions,QUOTE_CONDITIONS} from '../src/pricing/reply-guard';
const pricing=pricingSchema.parse({tariffs:[
  {code:'DIGITAL',priceRetail:6,priceWholesale:5,priceLargeWholesale:4},
  {code:'PRINT',priceRetail:18,priceWholesale:16,priceLargeWholesale:13},
  {code:'STANDARD',priceRetail:42,priceWholesale:39,priceLargeWholesale:32},
  {code:'PRO',priceRetail:72,priceWholesale:65,priceLargeWholesale:55}],
  pricingSettings:{volumeTier1:5000,volumeTier2:25000,ssccPrice:50,stickerLayoutPrice:5000,selfLayoutPrice:1000,urgentPercent:25,expressDeliveryPrice:15000,outsourcingOneTimePrice:79900,cardNktPrice:150,cardMptPrice:200,cardFullPackagePrice:300}});
const badInput={tariff:'STANDARD',itemsCount:20000,cardsCount:30,cardService:'FULL',onboarding:true};
let server:Server,origin:string,cookie:string,clientId:string,otherClientId:string,sessionId:string,quoteId:string;
const source=async()=>new Response(JSON.stringify(pricing),{headers:{'content-type':'application/json'}});
const call=(route:string,options:RequestInit={})=>fetch(origin+route,{...options,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:cookie,...options.headers}});
before(async()=>{
  if(!process.env.CRM_TEST_DATABASE)throw Error('Use isolated tests');
  await prisma.adminUser.createMany({data:[{telegramChatId:'8563274673'}],skipDuplicates:true});
  const user=await prisma.adminUser.findUniqueOrThrow({where:{telegramChatId:'8563274673'}});
  const session=await prisma.authSession.create({data:{userId:user.id,expiresAt:new Date(Date.now()+180000)}});sessionId=session.id;
  cookie='tanbox_session='+jwt.sign({sub:user.id,jti:session.id},env.JWT_SECRET,{issuer:'tanbox-crm',audience:'tanbox-web',expiresIn:'3m'});
  clientId=(await prisma.client.create({data:{name:'Synthetic quote client'}})).id;otherClientId=(await prisma.client.create({data:{name:'Other quote client'}})).id;
  server=await new Promise<Server>(r=>{const s=createApp().listen(0,'127.0.0.1',()=>r(s));});origin='http://127.0.0.1:'+(server.address() as any).port;
  await loadPricing({force:true,fetcher:source});
});
after(async()=>{
  // Keep one complete, valid quote in this disposable database for dump/restore checks.
  await prisma.commercialQuote.deleteMany({where:{clientId}});await saveQuote(clientId,badInput);
  await prisma.authSession.deleteMany({where:{id:sessionId}});await prisma.systemSetting.deleteMany({where:{key:PRICING_KEY}});
  await new Promise<void>(r=>server.close(()=>r()));await prisma.$disconnect();
});
test('commercial calculation reproduces the supplied offer and explicit rounded discount',()=>{
  const c=calculateQuote(badInput,pricing);assert.equal(c.total,883900);assert.deepEqual(c.brackets.map(b=>b.subtotal),[210000,585000]);assert.equal(c.lines.find(l=>l.key==='cards')?.total,9000);
  const discounted=calculateQuote({...badInput,discountAmount:133900,discountReason:'Individual approved reduction'},pricing);assert.equal(discounted.total,750000);
  assert(c.notes.some(n=>n.includes('оператору отдельно')));assert(!c.lines.some(l=>/operator|vat|warehouse/.test(l.key)));
});
test('tiers, PRO minimum and included SSCC preserve the pricing boundaries',()=>{
  assert.equal(calculateQuote({tariff:'STANDARD',itemsCount:200},pricing).total,8400);
  assert.throws(()=>calculateQuote({tariff:'PRO',itemsCount:499},pricing),/500/);
  assert.equal(calculateQuote({tariff:'PRO',itemsCount:500,ssccNeeded:true,boxesCount:30},pricing).total,36000);
  assert.deepEqual(calculateQuote({tariff:'STANDARD',itemsCount:25001},pricing).brackets.map(b=>b.count),[5000,20000,1]);
  assert.throws(()=>calculateQuote({tariff:'STANDARD',itemsCount:10,ssccNeeded:true},pricing));
});
test('extras are charged once and urgency excludes cards, onboarding, layout and delivery',()=>{
  const c=calculateQuote({tariff:'STANDARD',itemsCount:501,ssccNeeded:true,boxesCount:2,urgent:true,layout:'DESIGN',delivery:true,cardsCount:1,cardService:'FULL',onboarding:true},pricing);
  assert.equal(c.lines.find(l=>l.key==='urgency')?.total,Math.round((501*42+100)*0.25));
  assert.equal(c.lines.filter(l=>l.key==='layout').length,1);assert.equal(c.lines.find(l=>l.key==='layout')?.total,5000);
  assert.throws(()=>calculateQuote({tariff:'STANDARD',itemsCount:1,discountAmount:1},pricing));
  assert.throws(()=>calculateQuote({tariff:'STANDARD',itemsCount:1,discountAmount:100,discountReason:'x'},pricing));
  assert.throws(()=>calculateQuote({tariff:'STANDARD',itemsCount:1,total:1},pricing));
  const bad=structuredClone(pricing) as any;bad.tariffs[0].priceRetail=null;assert.throws(()=>pricingSchema.parse(bad));
});
test('reply price guard accepts formatted calculated values and rejects invented amounts',()=>{
  const c=calculateQuote(badInput,pricing);
  assert.doesNotThrow(()=>validateReplyPrices(['Итого 883\u202f900,00 ₸; работы по маркировке 795 000 тенге.'],c));
  assert.throws(()=>validateReplyPrices(['Цена 800 000 ₸'],c),/сумму/);
  assert.throws(()=>validateReplyPrices(['Стоимость 750000 KZT']),/сумму/);
  const formatted=withQuoteConditions('Итого услуги 883 900 ₸',c);assert(formatted.includes('оператору отдельно'));assert(formatted.includes('брокер не включены'));
  assert.equal(withQuoteConditions(formatted,c).split(QUOTE_CONDITIONS).length,2);
  assert.equal(withQuoteConditions('Подскажите количество единиц.',c),'Подскажите количество единиц.');
});
test('automatic quote needs an exact party size and unambiguous service',()=>{
  const incoming=(content:string)=>[{sender:'CLIENT',content}];
  assert.deepEqual(inferAutomaticQuote(incoming('У нас партия 200 пар обуви. Нужна оклейка без вскрытия коробов.')),{tariff:'STANDARD',itemsCount:200});
  assert.equal(inferAutomaticQuote(incoming('У нас партия от 200 пар обуви. Нужна оклейка без вскрытия коробов.')),null);
  assert.equal(inferAutomaticQuote([...incoming('У нас партия 200 пар обуви. Нужна оклейка без вскрытия коробов.'),...incoming('Теперь партия от 300 пар обуви.')]),null);
  assert.equal(inferAutomaticQuote(incoming('У нас 200 пар обуви, нужна полная маркировка.')),null);
  assert.equal(inferAutomaticQuote(incoming('У нас 200 пар обуви, нужна оклейка без вскрытия на СВХ.')),null);
  const guide=publishedTariffGuide(pricing,'Нужна полная маркировка',true);
  assert(guide.includes('42 ₸/ед.'));
  assert(guide.includes('72 ₸/ед.'));
  assert(!/Итого\s*:/u.test(guide));
  assert.doesNotThrow(()=>validateReplyPrices([guide],null,pricing));
  const extended=pricingSchema.parse({...pricing,pricingSettings:{...pricing.pricingSettings,trainingCoursePrice:85000}});
  const training=publishedTariffGuide(extended,'Нужны оборудование и обучение сотрудников маркировке',false);
  assert(/85[\s\u00a0\u202f]000 ₸/u.test(training));
  assert(!training.includes('42 ₸/ед.'));
  assert.doesNotThrow(()=>validateReplyPrices([training],null,extended));
});
test('commercial offer creates one current site-backed calculation automatically',async()=>{
  const client=await prisma.client.create({data:{name:'Automatic quote client',category:'SHOES',conversations:{create:{messages:{create:{sender:'CLIENT',content:'У нас партия 200 пар обуви. Нужна оклейка без вскрытия коробов.',position:0}}}}}});
  try{
    const first=await aiOrchestrator.generateSuggestedReply({clientId:client.id,intent:'COMMERCIAL_OFFER'});
    assert.equal(first.pricedOffer,true);
    assert.equal(first.commercialEvidence?.calculation.total,8400);
    assert.equal(first.commercialEvidence?.sourceUrl,'https://tanbox.kz/api/tariffs');
    assert(first.reply.includes('8 400 ₸')||first.reply.includes('8 400 ₸'));
    const second=await aiOrchestrator.generateSuggestedReply({clientId:client.id,intent:'COMMERCIAL_OFFER'});
    assert.equal(second.commercialEvidence?.quoteId,first.commercialEvidence?.quoteId);
    assert.equal(await prisma.commercialQuote.count({where:{clientId:client.id}}),1);
    const original=geminiService.generateReply;
    try{
      geminiService.generateReply=async()=>({reply:second.reply+'\n\nТекст сокращён по просьбе менеджера.',explanation:'Уточнён черновик.',variations:[]});
      const revised=await aiOrchestrator.reviseDraft({clientId:client.id,suggestionId:second.suggestionId,instruction:'Сделай КП короче, сохрани расчёт.'});
      assert.equal(revised.commercialEvidence?.quoteId,second.commercialEvidence?.quoteId);
      assert(revised.reply.includes('8 400 ₸')||revised.reply.includes('8 400 ₸'));
      const savedCount=await prisma.aISuggestion.count({where:{clientId:client.id}});
      await assert.rejects(aiOrchestrator.reviseDraft({clientId:client.id,suggestionId:revised.suggestionId,instruction:'Поменяй тариф на PRO.'}),/новый расчёт/);
      geminiService.generateReply=async()=>({reply:'Итого 999 999 ₸',explanation:'Новая цена',variations:[]});
      await assert.rejects(aiOrchestrator.reviseDraft({clientId:client.id,suggestionId:revised.suggestionId,instruction:'Поставь другую цену.'}),/сумму/);
      assert.equal(await prisma.aISuggestion.count({where:{clientId:client.id}}),savedCount);
    }finally{geminiService.generateReply=original;}
  }finally{await prisma.client.delete({where:{id:client.id}});}
});
test('quote endpoints require authentication and server computes the value instead of trusting a submitted total',async()=>{
  assert.equal((await fetch(origin+'/api/ai/pricing')).status,401);
  assert.equal((await call('/api/ai/quotes',{method:'POST',body:JSON.stringify({clientId,input:{...badInput,total:1}})})).status,400);
  const response=await call('/api/ai/quotes',{method:'POST',body:JSON.stringify({clientId,input:badInput})});assert.equal(response.status,201);
  const {quote}=await response.json() as any;quoteId=quote.id;assert.equal(Number(quote.total),883900);assert.equal(quote.calculation.total,883900);
  assert((await quoteForReply(clientId,quoteId)).evidence?.quoteId===quoteId);
  await assert.rejects(quoteForReply(otherClientId,quoteId),/этого клиента/);
  const list=await (await call('/api/ai/quotes?clientId='+clientId+'&limit=1')).json() as any;assert.equal(list.quotes[0].id,quoteId);assert.equal(list.total,1);
});
test('AI receives exact frozen calculation and persists its provenance',async()=>{
  const old=geminiService.generateReply;let context='';geminiService.generateReply=async options=>{context=options.knowledgeContext||'';return {reply:'Расчёт подготовлен, уточним состав работ.',explanation:'Use the saved calculation.',variations:[]};};
  try{
    const r=await aiOrchestrator.generateSuggestedReply({clientId,quoteId,provider:'GEMINI',userPrompt:'Объясни подготовленный расчёт стоимости.'});
    assert(context.includes('883900'));assert.equal(r.commercialEvidence?.quoteId,quoteId);
    const saved=await prisma.aISuggestion.findUniqueOrThrow({where:{id:r.suggestionId}});assert.equal((saved.commercialEvidence as any).quoteId,quoteId);
    const offer=await aiOrchestrator.generateSuggestedReply({clientId,quoteId,intent:'COMMERCIAL_OFFER'});
    assert.equal(offer.provider,'SERVER_TEMPLATE');assert.equal(offer.pricedOffer,true);
    assert(offer.reply.includes('883 900 ₸')||offer.reply.includes('883 900 ₸'));
    assert.equal(offer.commercialEvidence?.quoteId,quoteId);
    const count=await prisma.aISuggestion.count({where:{clientId}});
    geminiService.generateReply=async()=>({reply:'Цена 999 999 ₸',explanation:'Unsupported value',variations:[]});
    await assert.rejects(aiOrchestrator.generateSuggestedReply({clientId,quoteId,provider:'GEMINI',userPrompt:'Объясни расчёт стоимости.'}),/сумму/);
    assert.equal(await prisma.aISuggestion.count({where:{clientId}}),count);
  }finally{geminiService.generateReply=old;}
});
test('expired, modified and revoked quotes are excluded without reviving an earlier version',async()=>{
  const changed=structuredClone(pricing);changed.tariffs[0].priceRetail=7;
  await loadPricing({force:true,fetcher:async()=>new Response(JSON.stringify(changed))});await assert.rejects(quoteForReply(clientId,quoteId),/Прайс изменился/);
  await loadPricing({force:true,fetcher:source});
  await prisma.commercialQuote.update({where:{id:quoteId},data:{calculation:{bad:true}}});await assert.rejects(quoteForReply(clientId,quoteId),/Проверка сохранённого/);
  const newest=await saveQuote(clientId,{tariff:'PRINT',itemsCount:100});
  await prisma.commercialQuote.update({where:{id:newest.id},data:{reviewAfter:new Date(Date.now()-1000)}});await assert.rejects(quoteForReply(clientId,newest.id),/обновления/);
  await prisma.commercialQuote.update({where:{id:newest.id},data:{reviewAfter:new Date(Date.now()+60000)}});
  assert.equal((await call('/api/ai/quotes/'+newest.id+'/revoke',{method:'POST',body:'{}'})).status,200);
  assert.equal((await quoteForReply(clientId)).evidence,null);
});
test('failed or malformed source does not create zero prices or use a cache older than a day',async()=>{
  const setting=await prisma.systemSetting.findUniqueOrThrow({where:{key:PRICING_KEY}}),snapshot=JSON.parse(setting.value);
  await loadPricing({force:true,fetcher:async()=>new Response('{}')});
  snapshot.checkedAt=new Date(Date.now()-2*86400000).toISOString();await prisma.systemSetting.update({where:{key:PRICING_KEY},data:{value:JSON.stringify(snapshot)}});
  await assert.rejects(loadPricing({force:true,fetcher:async()=>new Response('{}')}),/актуальный прайс/);
  await loadPricing({force:true,fetcher:source});
  const q=await saveQuote(otherClientId,{tariff:'DIGITAL',itemsCount:200});await prisma.client.delete({where:{id:otherClientId}});assert.equal(await prisma.commercialQuote.count({where:{id:q.id}}),0);
});

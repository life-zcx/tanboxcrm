import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,clientInput} from '../src/lib/validation';
import {hashCode,matchesCode} from '../src/lib/security';
import {knownTimestamp} from '../src/ai/ai.orchestrator';
import {findImportOverlap,selectCoherentReply,removeRepeatedGreeting} from '../src/ai/conversation-timeline';

test('import overlap checks author and keeps short repeated replies',()=>{
  const message=(sender:string,content:string,position:number,originalTime?:string)=>({sender,content,position,originalTime});
  const old=[message('CLIENT','Hello',0,'17:21'),message('CLIENT','Please prepare a complete commercial offer for this shipment',1,'17:22')];
  assert.equal(findImportOverlap(old,[...old,message('MANAGER','We can prepare it',2)]),2);
  assert.equal(findImportOverlap(old,[message('MANAGER','Hello',0,'17:21'),old[1]]),0);
  assert.equal(findImportOverlap(old,[message('CLIENT','Hello',0,'17:21')]),0);
  assert.equal(findImportOverlap(old,[message('CLIENT','Please prepare a complete commercial offer for this shipment',0,'17:22')]),1);
});
import {buildCommercialOfferDraft} from '../src/ai/commercial-offer-draft';
import {parsedConversationSchema} from '../src/ai/gemini.service';
import {GeminiService} from '../src/ai/gemini.service';
import {env} from '../src/config/env';
import {prepareImages,imageFilename} from '../src/lib/files';
import {assignScreenshotSenders,mergeScreenshotMessages, OrderedMessage} from '../src/ai/conversation-order';
import {correctShortMessageSides} from '../src/ai/screenshot-side';
import {splitPassages} from '../src/knowledge/archive.service';

test('knowledge passages preserve every character, newlines and Unicode',()=>{
  const text=('Полный текст: Казахстан 🦊\n\n'.repeat(5000))+'LAST_CHARACTER_SENTINEL';
  const chunks=splitPassages(text);
  assert(chunks.length>40);assert.equal(chunks.join(''),text);
  assert(chunks.every(c=>c.length<=2400&&!/[\uD800-\uDBFF]$/.test(c)));
});
test('phone normalization is exact and rejects empty/short identifiers',()=>{
  assert.equal(normalizePhone('+7 (707) 123-45-67'),'77071234567');
  assert.equal(normalizePhone('8 707 123 45 67'),'77071234567');
  assert.equal(normalizePhone('+-() '),null);assert.equal(normalizePhone('123'),null);
});
test('reply selection drops a repeated greeting and rejects questions already answered by the client',()=>{
  const known={fullOutsourcing:true,assortmentUnknown:true,codesUnknown:true};
  const primary=removeRepeatedGreeting('Добрый день! Потребуется ли вам печать файлов или полная оклейка?',true);
  const safe='Для предварительного КП по полному аутсорсингу подскажите ориентировочное количество единиц первой партии?';
  const result=selectCoherentReply(primary,[safe,'Уточните точный ассортимент одежды?'],known);
  assert.equal(result.reply,safe);
  assert.deepEqual(result.variations,[]);
  assert.equal(removeRepeatedGreeting('Добрый день! Первый контакт.',false),'Добрый день! Первый контакт.');
});
test('commercial offer draft keeps missing price open and uses only a supplied calculation',()=>{
  const base={clientName:'Tatyana',category:'CLOTHES',clientText:'Одежда на СВХ в Алматы',fullOutsourcing:true,warehouse:true,almaty:true,partyQuantityKnown:false,assortmentUnknown:true,codesUnknown:true};
  const preliminary=buildCommercialOfferDraft(base);
  assert(preliminary.reply.includes('предварительное, без цены'));
  assert(preliminary.reply.includes('Точная сумма пока не рассчитана'));
  assert(preliminary.reply.includes('Площадка'));
  assert(!/\d[\d ]*\s*₸/.test(preliminary.reply));
  const calculation={tariffName:'Стандарт',input:{itemsCount:200},lines:[{title:'Нанесение',total:40000}],discountAmount:0,total:40000,notes:['По согласованному составу работ']} as any;
  const priced=buildCommercialOfferDraft({...base,calculation});
  assert(priced.reply.includes('40 000 ₸')||priced.reply.includes('40 000 ₸'));
  assert(priced.reply.includes('коды оплачиваются оператору отдельно'));
});
test('client update refuses nested Prisma mutations and invalid values',()=>{
  assert.equal(clientInput.safeParse({deals:{deleteMany:{}}}).success,false);
  assert.equal(clientInput.safeParse({id:'replacement'}).success,false);
  assert.equal(clientInput.safeParse({status:'HIDDEN'}).success,false);
  assert.equal(clientInput.safeParse({estimatedAmount:-1}).success,false);
});
test('OTP hashes are bound to challenge and compare safely',()=>{
  const digest=hashCode('first','123456');
  assert(!digest.includes('123456'));
  assert(matchesCode('first','123456',digest));
  assert(!matchesCode('second','123456',digest));
  assert(!matchesCode('first','000000',digest));
});
test('timestamps never invent a calendar date for OCR time only',()=>{
  assert.equal(knownTimestamp('14:32'),null);
  assert.equal(knownTimestamp('2026-11-09T14:32:00+05:00')?.toISOString(),'2026-11-09T09:32:00.000Z');
  assert.equal(knownTimestamp('2026-99-09T14:32:00Z'),null);
});
test('AI schema rejects wrong shape before database operations',()=>{
  assert(!parsedConversationSchema.safeParse({clientName:'Test',messages:'not an array'}).success);
});
test('screenshot geometry corrects short incoming messages and missed calls before assigning authors',()=>{
  const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+[
    '5\t1\t1\t1\t1\t1\t71\t698\t53\t14\t89.4\tДобрый',
    '5\t1\t2\t1\t1\t1\t131\t749\t107\t15\t92.1\tПропущенный',
    '5\t1\t3\t1\t1\t1\t980\t600\t75\t14\t90.0\tОтправил',
  ].join('\n');
  const corrected=correctShortMessageSides([
    {side:'RIGHT',content:'Добрый день!',time:'09:38'},
    {side:'RIGHT',content:'Пропущенный аудиозвонок\nНажмите, чтобы перезвонить',time:'09:40'},
    {side:'LEFT',content:'Отправил',time:'09:41'},
  ],tsv,1270,859);
  const assigned=assignScreenshotSenders([{imageIndex:1,messages:corrected}])[0].messages;
  assert.deepEqual(assigned.map(m=>m.sender),['CLIENT','CLIENT','MANAGER']);
  assert.equal(assigned[1].content,'Пропущенный аудиозвонок');
});
test('active documents cannot be treated as images or accessible upload paths',async()=>{
  await assert.rejects(prepareImages([{buffer:Buffer.from('<svg><script>alert(1)</script></svg>'),mimeType:'image/png'}]));
  assert.equal(imageFilename('/uploads/screenshot-123-12.html'),null);
  assert.equal(imageFilename('/uploads/../secrets.jpg'),null);
});
test('Gemini uses only configured fallback and respects failed-model cooldowns',async()=>{
  const model=env.GEMINI_MODEL, fallback=[...env.GEMINI_FALLBACK_MODELS];
  env.GEMINI_MODEL='primary';env.GEMINI_FALLBACK_MODELS.splice(0,env.GEMINI_FALLBACK_MODELS.length,'backup');
  try {
    let primary=0,backup=0;
    const service=new GeminiService() as any;
    service.client={getGenerativeModel:({model}:{model:string})=>({generateContent:async()=>{
      if(model==='primary'){primary++;throw {status:429,errorDetails:[{retryDelay:'3600s'}]};}
      backup++;return {response:{text:()=>JSON.stringify({ok:true})}};
    }})};
    assert.deepEqual(await service.request('synthetic'),{ok:true});
    assert.deepEqual(await service.request('synthetic'),{ok:true});
    assert.equal(primary,1);assert.equal(backup,2);assert.equal(service.getStatus().model,'backup');
  } finally {env.GEMINI_MODEL=model;env.GEMINI_FALLBACK_MODELS.splice(0,env.GEMINI_FALLBACK_MODELS.length,...fallback);}
});
test('Gemini circuit breaker prevents repeated calls when all models are rate limited',async()=>{
  let calls=0;const service=new GeminiService() as any;
  service.client={getGenerativeModel:()=>({generateContent:async()=>{calls++;throw {status:429};}})};
  await assert.rejects(service.request('synthetic'));
  const count=calls;
  await assert.rejects(service.request('synthetic'));
  assert.equal(calls,count);
});
test('screenshots retain image order across midnight and remove only boundary overlaps',()=>{
  const a:OrderedMessage={sender:'CLIENT',content:'Нужны коды на сто пар обуви',time:'23:58'};
  const b:OrderedMessage={sender:'MANAGER',content:'Уточните дату поставки товара',time:'23:59'};
  const c:OrderedMessage={sender:'CLIENT',content:'На следующей неделе',time:'00:01'};
  const d:OrderedMessage={sender:'MANAGER',content:'Ок',time:'00:02'};
  const screens=[{imageIndex:2,messages:[b,c,d]},{imageIndex:1,messages:[a,b,c]}];
  assert.deepEqual(mergeScreenshotMessages(screens,2),[a,b,c,d]);
  assert.deepEqual(mergeScreenshotMessages(screens,2).map(m=>m.time),['23:58','23:59','00:01','00:02']);
});
test('repeated short messages on different screenshots are not globally deduplicated',()=>{
  const a:OrderedMessage={sender:'CLIENT',content:'Ок',time:'10:00'};
  const b:OrderedMessage={sender:'CLIENT',content:'Ок',time:'10:01'};
  assert.equal(mergeScreenshotMessages([{imageIndex:1,messages:[a]},{imageIndex:2,messages:[b]}],2).length,2);
  assert.equal(mergeScreenshotMessages([{imageIndex:1,messages:[a]},{imageIndex:2,messages:[a]}],2).length,2);
});
test('missing or duplicate screenshot indices cannot silently produce a conversation',()=>{
  assert.throws(()=>mergeScreenshotMessages([{imageIndex:1,messages:[]}],2));
  assert.throws(()=>mergeScreenshotMessages([{imageIndex:1,messages:[]},{imageIndex:1,messages:[]}],2));
});

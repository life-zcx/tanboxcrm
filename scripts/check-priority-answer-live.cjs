// Synthetic legal scenario only. No private customer data is read or sent.
const assert=require('node:assert/strict');
const path=require('node:path');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {knowledgeForReply}=require('../backend/dist/knowledge/web.retrieval');
const {geminiService}=require('../backend/dist/ai/gemini.service');
const {prisma}=require('../backend/dist/config/db');

(async()=>{
  const question='У нас БАД, произведённые до 1 сентября 2026 года. Можно ли продать остатки без маркировки?';
  const knowledge=await knowledgeForReply({query:question,category:'DIETARY_SUPPLEMENTS'});
  assert(knowledge.evidence.some(e=>e.key==='kz-bad-earlier-stock'));
  const result=await geminiService.generateReply({
    clientSummary:'Синтетическая проверка ответа по БАД в Казахстане. Данные настоящего клиента не используются.',
    recentMessages:[{sender:'CLIENT',content:question}],
    userPrompt:'Ответь коротко и понятно. Назови условия и данные, которые нужно проверить по конкретной партии.',
    knowledgeContext:knowledge.context,
  });
  assert(result.reply.length>30);
  assert(/срок|годност/i.test(result.reply),'Reply omitted expiry condition');
  assert(/производ|дат/i.test(result.reply),'Reply omitted production date');
  console.log(JSON.stringify({reply:result.reply,factKeys:knowledge.evidence.map(e=>e.key),conditionsChecked:true}));
  const importQuestion='Мы импортируем БАД в Казахстан. Можно ли наклеить коды на своём складе уже после выпуска товара?';
  const importKnowledge=await knowledgeForReply({query:importQuestion,category:'DIETARY_SUPPLEMENTS'});
  assert(importKnowledge.evidence.some(e=>e.key==='kz-bad-rule-86-import-before-border'));
  const importResult=await geminiService.generateReply({
    clientSummary:'Синтетическая проверка ответа об импорте БАД. Данные настоящего клиента не используются.',
    recentMessages:[{sender:'CLIENT',content:importQuestion}],
    userPrompt:'Ответь коротко. Укажи, что именно нужно проверить для решения по этой партии.',
    knowledgeContext:importKnowledge.context,
  });
  assert(/до ввоза|до (?:их )?помещения|до выпуска/i.test(importResult.reply),'Reply omitted the legal marking boundary');
  assert(/СГР|свидетельств/i.test(importResult.reply),'Reply omitted registration certificate check');
  console.log(JSON.stringify({reply:importResult.reply,factKeys:importKnowledge.evidence.map(e=>e.key),conditionsChecked:true}));
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>prisma.$disconnect());

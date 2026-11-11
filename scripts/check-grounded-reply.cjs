const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {prisma}=require('../backend/dist/config/db');
const {knowledgeForReply}=require('../backend/dist/knowledge/web.retrieval');
const {geminiService}=require('../backend/dist/ai/gemini.service');
async function main(){
 const query='Когда вводится маркировка пива по видам тары? Укажи полные даты и условия по дате производства.';
 const knowledge=await knowledgeForReply({query,category:'BEER'});assert(knowledge.evidence.some(e=>e.key==='kz-beer-phases'));
 const result=await geminiService.generateReply({clientSummary:'Синтетическая проверка: клиент уточняет требования к пиву в РК. Данные реальных клиентов не используются.',recentMessages:[{sender:'CLIENT',content:query}],userPrompt:'Подготовь короткий ответ с датами для кегов, бутылок и банок, отдельно отметь будущий этап.',knowledgeContext:knowledge.context});
 assert(result.reply.includes('2026'));assert(result.reply.includes('2027'));assert(!/50.{0,10}500|гарантируем/i.test(result.reply));
 const guard=await knowledgeForReply({query:'Какой штраф за отсутствие маркировки обуви?',category:'SHOES'});assert.equal(guard.needsClarification,true);
 const report={reply:result.reply,factKeys:knowledge.evidence.map(e=>e.key),sources:knowledge.evidence.flatMap(e=>e.sources.map(s=>s.url)),unsupportedLegalQuestionBlocked:true};
 fs.writeFileSync(path.join(__dirname,'../test-results/grounded-reply.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

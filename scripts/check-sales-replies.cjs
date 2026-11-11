// Synthetic scenarios only. This script never reads private conversation files,
// creates clients or sends messages to customers.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {prisma}=require('../backend/dist/config/db');
const {geminiService}=require('../backend/dist/ai/gemini.service');
const {salesGuidance,SALES_GUIDANCE_VERSION}=require('../backend/dist/ai/sales-guidance');
const {knowledgeForReply}=require('../backend/dist/knowledge/web.retrieval');
const cases=[
 {id:'bad-unanswered-offer',category:'bad',task:'Напомни о КП, клиент не отвечает.',messages:[{sender:'CLIENT',content:'Планируем БАД, первая партия 30 тысяч единиц, за год 90 тысяч. Город и брокера уже обсудили.'},{sender:'MANAGER',content:'[Документ] Предложение по партии.'}]},
 {id:'shoes-ready-buyer',category:'shoes',task:'Предложи следующий шаг, клиент готов начать.',messages:[{sender:'CLIENT',content:'Доставляем в Алматы, первая партия 300 пар спортивной обуви, магазин в Казахстане. Мы готовы заказать, значит сразу начнем.'}]},
 {id:'manufacturer-unknown-call',category:'textile',task:'Повторный контакт после отправленного предложения.',messages:[{sender:'CLIENT',content:'Мы производим одежду в Алматы, импорта нет. Можно обсудить по телефону?'},{sender:'SYSTEM',content:'[Звонок без записи итогов]'},{sender:'MANAGER',content:'[Документ] Предложение.'}]},
 {id:'ambiguous-price-reaction',category:'bad',task:'Обоснуй стоимость и уточни реакцию без скидки.',messages:[{sender:'MANAGER',content:'[Документ] КП без текста и сумм в истории.'},{sender:'CLIENT',content:'😱'}]},
 {id:'textile-director-unknown-volume',category:'textile',task:'Предложи следующий шаг для обсуждения предложения с руководителем.',messages:[{sender:'CLIENT',content:'Часть одежды уже здесь, часть ещё поступит. Объём не знаю. Можете КП? Передам руководителю.'}]},
 {id:'equipment-self-marking',category:'textile',task:'Предложи следующий шаг по оборудованию и обучению. Цену не придумывай.',messages:[{sender:'CLIENT',content:'У нас собственное производство одежды. Хотим печатать этикетки сами, нужен принтер и обучение небольшой команды. Работаем через личный кабинет, без 1С.'}]},
];
async function main(){
 const results=[],errors=[],selected=process.argv[2]?cases.filter(c=>c.id===process.argv[2]):cases;
 assert(selected.length>0,'Unknown synthetic case');
 const target=path.join(__dirname,'../test-results/'+(process.argv[2]?'sales-reply-'+selected[0].id:'sales-replies')+'.json');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const save=()=>fs.writeFileSync(target,JSON.stringify({checkedAt:new Date().toISOString(),guidanceVersion:SALES_GUIDANCE_VERSION,synthetic:true,checksPassed:results.length,totalCases:selected.length,errors,results},null,2));
 for(const c of selected){
  try{
  const sales=salesGuidance({category:c.category,messages:c.messages,managerTask:c.task});
  const knowledge=await knowledgeForReply({query:c.task,category:c.category});
  const result=await geminiService.generateReply({clientSummary:'Синтетический сценарий проверки. Персональных данных и реального клиента нет.',recentMessages:c.messages,userPrompt:c.task,knowledgeContext:knowledge.context+'\n'+sales.context,style:'FRIENDLY'});
  const reply=result.reply;assert(reply.length>20&&reply.length<1600);assert((reply.match(/\?/g)||[]).length<=2,'Too many questions: '+c.id);
  assert(!/скидк.{0,12}\d|\d\s*%|штраф|блокировк|\d[\d\s.,]*\s*(?:₸|тенге)/i.test(reply),'Unapproved monetary/legal promise: '+c.id);
  if(c.id==='shoes-ready-buyer')assert(!/в как(?:ой|ом) город|какой.*объ[её]м|сколько.*пар|зарегистрир.*(?:ип|тоо)/i.test(reply),'Known parameters asked again');
  if(c.id==='manufacturer-unknown-call')assert(!/как (?:мы )?договорились|согласованн|срок(?:и|а).*согласовал/i.test(reply),'Invented call agreement');
  if(c.id==='equipment-self-marking'){assert.equal(sales.key,'equipment_training');assert(/принтер|оборудован/i.test(reply));assert(/обуч|сотрудник|команд/i.test(reply));assert(!/выстав.*сч[её]т|145\s*000|245\s*000|85\s*000|60\s*000/i.test(reply));}
  results.push({id:c.id,scenario:sales.key,reply,explanation:result.explanation,questions:(reply.match(/\?/g)||[]).length});
  console.log(JSON.stringify({id:c.id,scenario:sales.key,passed:true}));
  save();
  }catch(e){errors.push({id:c.id,error:e.message});save();throw e;}
  await new Promise(r=>setTimeout(r,1500));
 }
 save();
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

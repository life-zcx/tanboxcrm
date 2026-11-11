const assert = require('node:assert/strict');
const path = require('node:path');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {knowledgeForReply}=require('../backend/dist/knowledge/web.retrieval');
const {webOverview}=require('../backend/dist/knowledge/web.service');
const {prisma}=require('../backend/dist/config/db');

const cases=[
  {query:'Как зарегистрировать обувь в системе маркировки?',category:'SHOES',key:'kz-shoes-registration-eds'},
  {query:'Какую этикетку и Data Matrix наносить на обувь?',category:'SHOES',key:'kz-shoes-datamatrix-per-pair'},
  {query:'Как зарегистрировать карточки товаров для текстиля?',category:'TEXTILE',key:'kz-textile-preparation-catalog'},
  {query:'Какую этикетку наносить на текстиль?',category:'TEXTILE',key:'kz-textile-datamatrix-per-item'},
  {query:'Как проходит модерация карточек БАД?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-cards-moderation'},
  {query:'Когда начинается прослеживаемость БАД?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-traceability-stage'},
  {query:'Что делать с остатками БАД, произведенными до обязательной маркировки?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-earlier-stock'},
  {query:'Когда вступают в силу правила маркировки текстиля по приказу 450?',category:'TEXTILE',key:'kz-textile-rule-450-staged-commencement'},
  {query:'Какие коды ТН ВЭД текстиля входят в перечень маркировки?',category:'TEXTILE',key:'kz-textile-rule-450-codes-and-list'},
  {query:'Какие пункты правил по БАД применяются к произведенным с 1 марта 2027 года?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-rule-86-production-stage'},
  {query:'Когда надо зарегистрироваться в ИС МПТ для оборота обуви?',category:'SHOES',key:'kz-shoes-rule-registration-before-trade'},
  {query:'Подлежит ли мой БАД маркировке, если есть СГР и код ТН ВЭД?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-rule-86-sgr-and-hs-code'},
  {query:'Как импортировать БАД и где нанести маркировку до ввоза?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-rule-86-import-before-border'},
  {query:'Можно ли продать немаркированные остатки БАД до срока годности?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-rule-86-unmarked-prelaunch-stock'},
  {query:'Кто регистрирует карточку БАД, производитель или импортер?',category:'DIETARY_SUPPLEMENTS',key:'kz-bad-rule-86-product-registration-role'},
  {query:'Как импортировать текстиль и когда нанести маркировку до ввоза?',category:'TEXTILE',key:'kz-textile-rule-450-import-before-border'},
  {query:'Как импортировать моторное масло и когда нанести маркировку до ввоза?',category:'OILS',key:'kz-oils-import-label-before-entry'},
  {query:'Как импортировать табачные изделия и когда нанести маркировку до ввоза?',category:'TOBACCO',key:'kz-tobacco-import-label-before-entry'},
  {query:'Как передать табачные изделия в обороте через ИС МПТ?',category:'TOBACCO',key:'kz-tobacco-circulation-record-required'},
  {query:'Заказали коды маркировки текстиля, когда их надо нанести и аннулируются ли они?',category:'TEXTILE',key:'kz-textile-rule-450-code-use-window'},
  {query:'Нужно ли маркировать упакованную воду в Казахстане?',category:'water',key:'kz-water-2022-pilot-decision'},
  {query:'Когда начнется цифровая маркировка медизделий?',category:'medical_devices',key:'kz-medical-devices-2027-plan'},
  {query:'Нужна ли обязательная маркировка газовых баллонов?',category:'lpg',key:'kz-lpg-2025-pilot-and-decision'},
  {query:'Как зарегистрировать косметику в системе маркировки?',category:'cosmetics',key:'kz-cosmetics-operator-rules-in-preparation'},
];

(async()=>{
  const overview=await webOverview();
  assert.equal(overview.stats.publishedFacts>=38,true);
  const disputed=await prisma.webKnowledgeSource.findUniqueOrThrow({where:{url:'https://tanba.telecom.kz/ru/business/product/supplements'}});
  assert(['NEEDS_REVIEW','READY'].includes(disputed.status));
  for(const item of cases){
    const result=await knowledgeForReply(item);
    const keys=result.evidence.map(e=>e.key);
    assert(keys.includes(item.key),`${item.key} absent for ${item.query}; got ${keys.join(', ')}`);
    if(disputed.status!=='READY')assert(result.evidence.every(e=>e.sources.every(s=>s.url!==disputed.url)),'Disputed BAD page reached an AI answer');
    console.log(JSON.stringify({query:item.query,key:item.key,topic:result.topic,evidence:keys}));
  }
  const cells=overview.matrix.flatMap(c=>c.topics);
  const coverage=Object.fromEntries([...new Set(cells.map(c=>c.status))].map(status=>[status,cells.filter(c=>c.status===status).length]));
  console.log(JSON.stringify({stats:overview.stats,coverage,checked:cases.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>prisma.$disconnect());

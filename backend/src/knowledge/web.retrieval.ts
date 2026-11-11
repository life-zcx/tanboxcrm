import {Prisma} from '@prisma/client';
import {prisma} from '../config/db';
import {usableFacts} from './web.service';
import {webTopics} from './web.registry';
import {asksForTechnicalStandards} from './web.scope';
export function inferTopic(query:string):string|undefined {
  const patterns:Record<string,RegExp>={liability:/штраф|ответственност|конфискац/i,customs:/тамож|свх|импортир|импорт(?!ер)|ввоз|экспорт|реимпорт/i,returns:/возврат|списан|поврежд|утер|потер/i,pricing:/стоим|цен[аыу]|сколько.*(?:стоит|платить|тенге|обойдется)|тариф/i,registration:/регистр|эцп|ncalayer|карточ[а-я]*|модерац|gtin|ntin/i,codes:/заказ.*код|получ.*код|оплат.*код|аннулир.*код|код.*(?:аннулир|получени|использован)|эмисси/i,dates:/когда|срок.*введ|с как|остатк|этап|дата|202[4-9]/i,integration:/api|1с|интеграц|офд|касс|ккм/i,labels:/этикет|нанес|накле|печат|сканер/i,warehouse:/агрегац|склад|sscc|короб/i,circulation:/передач|продаж|розниц|вывод.*оборот/i,applicability:/обязател|подлеж|нужн.*маркиров|маркиров.*нужн|перечень|исключен/i};
  return Object.entries(patterns).find(([,pattern])=>pattern.test(query))?.[0];
}
export function dateForKazakhstan(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
const aliases:Record<string,string>={SHOES:'shoes',CLOTHES:'textile',TEXTILE:'textile',MEDICINE:'pharma',WATER:'water',TOBACCO:'tobacco',BEER:'beer',OILS:'oils',DIETARY_SUPPLEMENTS:'bad',OTHER:''};
export async function identifyCategory(query:string,category?:string|null){
  const categories=await prisma.webKnowledgeCategory.findMany();
  const patterns:Record<string,RegExp>={shoes:/обув|ботин|кроссов|сапог|сандал/i,textile:/одежд|текстил|легпром|куртк|футболк|брюк|плать/i,pharma:/лекарств|препарат|фарма/i,tobacco:/табак|табач|сигарет|сигарилл/i,beer:/пив[аоуе]|кег/i,oils:/моторн.*масл|антифриз|автохим|смазоч/i,bad:/\bБАД\b|добавк.*пищ|биологически активн/i,jewelry:/ювелир|украшен|драгметалл/i,water:/упакованн.*вод|питьев.*вод|минеральн.*вод/i,saiga:/сайгак|дериват/i,timber:/древесин|круглый лес/i,lpg:/газ.*баллон/i,cosmetics:/космет|бытов.*хими|шампун|парфюм/i,vegetable_oil:/растительн.*масл|масложиров/i,confectionery:/кондитер|конфет|шоколад/i,canned:/консерв/i,medical_devices:/медицинск.*издел|медиздел/i,fur:/шуб|мехов/i};
  // JavaScript \b does not recognise Cyrillic letters as word characters.
  patterns.bad=/(?<![\p{L}\p{N}])бад(?:ы|ов|ам|ами|ах)?(?![\p{L}\p{N}])|добавк.*пищ|биологически активн/iu;
  const explicit=categories.filter(c=>c.code!=='GENERAL'&&(patterns[c.code]?.test(query)||c.aliases.some(a=>a.length>3&&query.toLocaleLowerCase('ru-RU').includes(a.toLocaleLowerCase('ru-RU')))));
  if(explicit.length===1)return explicit[0].code;
  return category?(aliases[category]??categories.find(c=>c.code===category)?.code):undefined;
}
export async function searchWebPassages(query:string,category?:string){
  if(query.trim().length<2)return [];
  const includeTechnical=asksForTechnicalStandards(query);
  return prisma.$queryRaw<{id:string;revisionId:string;position:number;content:string;title:string;url:string;authority:string;quality:string;score:number}[]>(Prisma.sql`
    SELECT p.id,p."revisionId",p.position,p.content,s.title,s.url,s.authority,r.quality,
      ts_rank(p."searchVector",websearch_to_tsquery('russian',${query}))::float8 AS score
    FROM "WebKnowledgePassage" p JOIN "WebKnowledgeRevision" r ON r.id=p."revisionId"
    JOIN "WebKnowledgeSource" s ON s.id=r."sourceId" AND s."currentRevisionId"=r.id
    WHERE s.status IN ('READY','OCR_UNREVIEWED') AND r.quality IN ('FULLTEXT','OCR_UNREVIEWED')
      AND (${includeTechnical}::boolean OR NOT (s.url LIKE 'https://docs.eaeunion.org/upload/%' AND COALESCE(s."discoveredFrom",'') LIKE 'https://docs.eaeunion.org/%'))
      AND (${category||null}::text IS NULL OR ${category||null}=ANY(s."categoryCodes") OR 'GENERAL'=ANY(s."categoryCodes"))
      AND p."searchVector" @@ websearch_to_tsquery('russian',${query})
    ORDER BY score DESC,p.id LIMIT 20
  `);
}
export async function knowledgeForReply(options:{query:string;category?:string|null}){
  const category=await identifyCategory(options.query,options.category),topic=inferTopic(options.query);
  const tokens=options.query.toLocaleLowerCase('ru-RU').match(/[a-zа-яё0-9]{3,}/g)||[];
  const facts=(await usableFacts()).map(f=>{
    const sameCategory=!!category&&f.categoryCodes.includes(category);
    const text=(f.title+' '+f.keywords.join(' ')+' '+f.answer).toLocaleLowerCase('ru-RU');
    const hits=tokens.filter(t=>text.includes(t)).length;
    const correctCategory=sameCategory||f.categoryCodes.includes('GENERAL')||!category&&hits>=2;
    const correctTopic=!topic||f.topic===topic;
    return {fact:f,score:(sameCategory?20:0)+hits,eligible:correctCategory&&correctTopic&&(sameCategory||hits>0)};
  }).filter(v=>v.eligible).sort((a,b)=>b.score-a.score).slice(0,6).map(v=>v.fact);
  const evidence=facts.map(f=>({factId:f.id,key:f.key,title:f.title,answer:f.answer,conditions:f.conditions,reviewedAt:f.reviewedAt.toISOString(),sources:f.evidence.map(e=>({revisionId:e.revisionId,url:e.revision.source.url,title:e.revision.source.title,locator:e.locator,quote:e.quote,sha256:e.revision.contentHash}))}));
  const context='ПРОВЕРЕННЫЕ СВЕДЕНИЯ ПО ЗАПРОСУ. Юрисдикция: Казахстан. Дата ответа: '+dateForKazakhstan()+'. Категория: '+(category||'не определена')+'. Тема: '+(topic?webTopics[topic as keyof typeof webTopics]: 'общий вопрос')+'.\n'+JSON.stringify(evidence)+'\nИспользуй только относящиеся к ситуации утверждения и все их условия. Дата будущего этапа не означает, что обязанность действует сейчас. Если не хватает вида товара, кода, даты партии или роли — уточни. Архивные и непроверенные материалы не являются основанием для юридических выводов.';
  const legalIntent=!!topic&&['applicability','dates','customs','liability'].includes(topic);
  return {category,topic,context,evidence,needsClarification:legalIntent&&(!facts.length||!!category&&!facts.some(f=>f.categoryCodes.includes(category)))};
}

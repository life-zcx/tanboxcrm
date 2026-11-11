import * as cheerio from 'cheerio';
import {prisma} from '../config/db';
import {AppError} from '../lib/errors';
import {sha256} from './archive.service';
import {semanticHash} from './web.service';

const listUrl='https://adilet.zan.kz/rus/docs/G26TI000199';
const clean=(value:string)=>value.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const digits=(value:string)=>value.replace(/\D/g,'');

export interface MarkingListRow {
  number:string;
  code:string;
  codes:string[];
  product:string;
  requirement:string;
  partialCode:boolean;
}

export function parseMarkingListHtml(html:string):MarkingListRow[]{
  const doc=cheerio.load(html);
  const table=doc('table').toArray().find(item=>{
    const head=clean(doc(item).find('tr').first().text());
    return head.includes('ТН ВЭД ЕАЭС')&&head.includes('Дата введения');
  });
  if(!table)throw new Error('MARKING_LIST_TABLE_MISSING');
  const tableRows=doc(table).find('tr').toArray();
  const output:MarkingListRow[]=[];
  let carried:{number:string;code:string}|null=null;
  for(const row of tableRows.slice(1)){
    const cells=doc(row).children('td,th').toArray();
    const values=cells.map(cell=>clean(doc(cell).text()));
    let number:string,code:string,product:string,requirement:string;
    if(values.length===4){
      number=values[0].replace(/\.$/,'');code=values[1];product=values[2];requirement=values[3];
      carried=Number(doc(cells[0]).attr('rowspan')||1)>1&&Number(doc(cells[1]).attr('rowspan')||1)>1?{number,code}:null;
    }else if(values.length===2&&carried){
      number=carried.number;code=carried.code;product=values[0];requirement=values[1];carried=null;
    }else throw new Error('MARKING_LIST_ROW_SHAPE');
    const codes=(code.match(/\d[\d\s]*/g)||[]).map(digits);
    if(!/^\d+(?:\.\d+)?$/.test(number)||Number(number)<1||!codes.length||codes.some(value=>value.length<4||value.length>10)||!product||!requirement)throw new Error('MARKING_LIST_ROW_INVALID:'+number+':'+code);
    if(output.length){const previous=Number(output[output.length-1].number.split('.')[0]),current=Number(number.split('.')[0]);if(current<previous||current>previous+1)throw new Error('MARKING_LIST_NUMBER_SEQUENCE');}
    output.push({number,code,codes,product,requirement,partialCode:/^из\s/i.test(code)});
  }
  if(output.length<50||output[0].number!=='1')throw new Error('MARKING_LIST_INCOMPLETE');
  return output;
}

export function findMarkingListRows(rows:MarkingListRow[],input:string){
  if(!/^[\d\s]+$/.test(input)||digits(input).length<4||digits(input).length>10)throw new AppError(400,'Укажите код ТН ВЭД из 4–10 цифр');
  const query=digits(input);
  const matches=rows.flatMap(row=>row.codes.filter(code=>query.startsWith(code)||code.startsWith(query)).map(code=>({
    ...row,matchedCode:code,matchType:code===query?'EXACT':query.startsWith(code)?'BROADER':'NARROWER',
  })));
  const rank:Record<string,number>={EXACT:0,BROADER:1,NARROWER:2};
  matches.sort((a,b)=>rank[a.matchType]-rank[b.matchType]||b.matchedCode.length-a.matchedCode.length||Number(a.number)-Number(b.number));
  return {query,total:matches.length,rows:matches.slice(0,50)};
}

let cache:{revisionId:string;rows:MarkingListRow[]}|null=null;
export async function lookupMarkingList(code:string){
  // Validate user input before loading the official archive.
  findMarkingListRows([],code);
  const source=await prisma.webKnowledgeSource.findUnique({where:{url:listUrl},select:{status:true,currentRevisionId:true,lastSuccessAt:true}});
  if(source?.status!=='READY'||!source.currentRevisionId)throw new AppError(503,'Официальный перечень сейчас недоступен');
  const revision=await prisma.webKnowledgeRevision.findUnique({where:{id:source.currentRevisionId},select:{id:true,data:true,sha256:true,text:true,contentHash:true,quality:true}});
  if(!revision||revision.quality!=='FULLTEXT'||sha256(revision.data)!==revision.sha256||semanticHash(revision.text)!==revision.contentHash)throw new AppError(503,'Не удалось проверить сохранённую редакцию перечня');
  if(cache?.revisionId!==revision.id){
    let document:any;
    try{document=JSON.parse(Buffer.from(revision.data).toString('utf8')).document;}catch{throw new AppError(503,'Не удалось прочитать официальную редакцию перечня');}
    if(document?.group_number!=='G26TI000199'||document?.language!=='rus'||document?.is_actual!==true||typeof document?.text_content!=='string')throw new AppError(503,'Официальная редакция перечня не подтверждена');
    try{cache={revisionId:revision.id,rows:parseMarkingListHtml(document.text_content)};}catch{throw new AppError(503,'Таблица перечня изменилась; требуется сверка формата');}
  }
  return {...findMarkingListRows(cache.rows,code),sourceUrl:listUrl,revisionId:revision.id,contentHash:revision.contentHash,checkedAt:source.lastSuccessAt?.toISOString()||null,fresh:!!source.lastSuccessAt&&Date.now()-source.lastSuccessAt.getTime()<8*86400000,sourceRows:cache.rows.length};
}

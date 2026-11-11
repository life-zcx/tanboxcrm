import {spawn} from 'node:child_process';
import sharp from 'sharp';
import type {PositionedScreenshotMessage} from './conversation-order';

function word(value:string){return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]/gu,'');}

export function correctShortMessageSides(messages:PositionedScreenshotMessage[],tsv:string,width:number,height:number){
  const tokens=tsv.split(/\r?\n/).slice(1).map(line=>line.split('\t')).filter(parts=>parts.length>=12&&parts[0]==='5').map(parts=>({
    x:Number(parts[6]),y:Number(parts[7]),confidence:Number(parts[10]),value:word(parts.slice(11).join('\t')),
  })).filter(token=>Number.isFinite(token.x)&&Number.isFinite(token.y)&&token.confidence>=55&&token.y>=height*0.08);
  return messages.map(message=>{
    if(message.content.length>80)return message;
    const first=message.content.match(/[\p{L}]{4,}/u)?.[0];
    if(!first)return message;
    const matches=tokens.filter(token=>token.value===word(first));
    const left=matches.some(token=>token.x<width*0.3);
    const right=matches.some(token=>token.x>width*0.7);
    if(left===right)return message;
    return {...message,side:left?'LEFT' as const:'RIGHT' as const};
  });
}

async function tesseractTsv(buffer:Buffer){
  return new Promise<string|null>(resolve=>{
    const child=spawn('tesseract',['stdin','stdout','-l','rus+eng','tsv'],{stdio:['pipe','pipe','ignore']});
    const chunks:Buffer[]=[];let length=0,settled=false;
    const finish=(value:string|null)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(null);},5000);
    child.stdout.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>4*1024*1024){child.kill();finish(null);}else chunks.push(chunk);});
    child.on('error',()=>finish(null));
    child.on('close',code=>finish(code===0?Buffer.concat(chunks).toString('utf8'):null));
    child.stdin.on('error',()=>{});
    child.stdin.end(buffer);
  });
}

export async function verifyScreenshotSides(messages:PositionedScreenshotMessage[],buffer:Buffer){
  if(!messages.some(m=>m.content.length<=80))return messages;
  try{
    const metadata=await sharp(buffer).metadata();
    if(!metadata.width||!metadata.height)return messages;
    const scan=metadata.width>1800?await sharp(buffer).resize({width:1800}).toBuffer({resolveWithObject:true}):null;
    const tsv=await tesseractTsv(scan?.data||buffer);
    if(!tsv)return messages;
    return correctShortMessageSides(messages,tsv,scan?.info.width||metadata.width,scan?.info.height||metadata.height);
  }catch{return messages;}
}

type TimelineMessage={sender:string;content:string;position:number;originalTime?:string|null;timestamp?:Date|null};
type TimelineChunk<M extends TimelineMessage>={id:string;createdAt:Date;source:string;channel:string;messages:M[]};
export type TimelineEntry<M extends TimelineMessage>={message:M;chunkId:string;source:string;channel:string};

function key(message:TimelineMessage){
  const time=message.timestamp?.toISOString()||message.originalTime||'';
  return message.content.replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU')+'\u0000'+time;
}

// An import can repeat an earlier part of the chat even when a newer manual
// message has already been added. Only drop a contiguous prefix with the same
// author; a single short greeting or call event is too weak to identify a copy.
export function findImportOverlap(existing:TimelineMessage[],incoming:TimelineMessage[]):number{
  for(let count=Math.min(existing.length,incoming.length);count>0;count--){
    if(count===1&&incoming[0].content.trim().length<30&&!incoming[0].timestamp)continue;
    for(let start=existing.length-count;start>=0;start--){
      if(incoming.slice(0,count).every((message,index)=>message.sender===existing[start+index].sender&&key(message)===key(existing[start+index])))return count;
    }
  }
  return 0;
}

export function mergeConversationTimeline<M extends TimelineMessage>(chunks:TimelineChunk<M>[]):TimelineEntry<M>[] {
  const ordered=[...chunks].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||a.id.localeCompare(b.id));
  const timeline:TimelineEntry<M>[]=[];
  for(const chunk of ordered){
    const messages=[...chunk.messages].sort((a,b)=>a.position-b.position);
    let overlap=0;
    for(let count=Math.min(timeline.length,messages.length);count>0;count--){
      const matched=messages.slice(0,count).every((message,index)=>key(message)===key(timeline[timeline.length-count+index].message));
      if(matched&&(count>1||messages[0].content.trim().length>=30||!!messages[0].timestamp)){overlap=count;break;}
    }
    for(let index=0;index<overlap;index++)timeline[timeline.length-overlap+index]={message:messages[index],chunkId:chunk.id,source:chunk.source,channel:chunk.channel};
    for(const message of messages.slice(overlap))timeline.push({message,chunkId:chunk.id,source:chunk.source,channel:chunk.channel});
  }
  return timeline;
}

export function removeRepeatedGreeting(reply:string,hasHistory:boolean){
  if(!hasHistory)return reply;
  return reply.replace(/^\s*(?:(?:добрый\s+(?:день|вечер)|доброе\s+утро|здравствуйте|приветствую(?:\s+вас)?|привет)(?:[!.,\s]+|$))/iu,'').trim()||reply.trim();
}

export function replyIssueScore(reply:string,known:{fullOutsourcing:boolean;assortmentUnknown:boolean;codesUnknown:boolean}){
  let score=0;
  for(const question of reply.match(/[^.!?\n]*\?/gu)||[]){
    if(known.fullOutsourcing&&/(?:или|либо)/iu.test(question)&&/(?:печат|файл|код)/iu.test(question)&&/(?:нанес|оклей|аутсорс|полн)/iu.test(question))score+=10;
    if(known.fullOutsourcing&&/(?:нужн|потребу|хотит|планиру).{0,50}(?:нанес|оклей|аутсорс)/iu.test(question))score+=5;
    if(known.assortmentUnknown&&/(?:подскаж|уточн|пришл|какие|какой|перечень)/iu.test(question)&&/(?:ассортимент|вид.{0,15}одежд)/iu.test(question))score+=5;
    if(known.codesUnknown&&/(?:подскаж|уточн|пришл|какие|какой)/iu.test(question)&&/код.{0,10}тн\s*вэд/iu.test(question))score+=5;
  }
  return score;
}

export function selectCoherentReply(reply:string,variations:string[],known:{fullOutsourcing:boolean;assortmentUnknown:boolean;codesUnknown:boolean},fallback?:string){
  const candidates=[reply,...variations].map(value=>value.trim()).filter(Boolean);
  const ranked=candidates.map((value,index)=>({value,index,score:replyIssueScore(value,known)})).sort((a,b)=>a.score-b.score||a.index-b.index);
  if(!ranked.length)return {reply:fallback||reply,variations:[]};
  if(ranked[0].score>0&&fallback)return {reply:fallback,variations:[]};
  const selected=ranked[0].value;
  return {reply:selected,variations:ranked.slice(1).filter(item=>item.score===0&&item.value!==selected).map(item=>item.value).slice(0,2)};
}

import type {ConversationChunk,Message} from '../api';

export type TimelineEntry={message:Message;chunkId:string;source:string;channel:string};
const key=(message:Message)=>message.content.replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU')+'\u0000'+(message.timestamp||message.originalTime||'');

export function mergeConversationTimeline(chunks:ConversationChunk[]):TimelineEntry[]{
  const ordered=[...chunks].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id));
  const timeline:TimelineEntry[]=[];
  for(const chunk of ordered){
    const messages=[...chunk.messages].sort((a,b)=>a.position-b.position);
    let overlap=0;
    for(let count=Math.min(timeline.length,messages.length);count>0;count--){
      if(messages.slice(0,count).every((message,index)=>key(message)===key(timeline[timeline.length-count+index].message))&&(count>1||messages[0].content.trim().length>=30||!!messages[0].timestamp)){overlap=count;break;}
    }
    for(let index=0;index<overlap;index++)timeline[timeline.length-overlap+index]={message:messages[index],chunkId:chunk.id,source:chunk.source,channel:chunk.channel};
    for(const message of messages.slice(overlap))timeline.push({message,chunkId:chunk.id,source:chunk.source,channel:chunk.channel});
  }
  return timeline;
}

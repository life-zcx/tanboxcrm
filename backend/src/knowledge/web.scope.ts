export function isSupportingTechnicalSource(source:{url:string;discoveredFrom?:string|null}){
  return source.url.startsWith('https://docs.eaeunion.org/upload/')&&
    !!source.discoveredFrom?.startsWith('https://docs.eaeunion.org/');
}

export function asksForTechnicalStandards(query:string){
  return /техническ|техрегламент|стандарт|ГОСТ|ТР\s*ТС|безопасност/i.test(query);
}

export function sharedOperatorDocumentIds(
  sources:{id:string;authority:string;categoryCodes:string[];currentRevisionId:string|null}[],
  revisions:{id:string;sha256:string}[],
){
  const hashes=new Map(revisions.map(revision=>[revision.id,revision.sha256]));
  const groups=new Map<string,{ids:string[];categories:Set<string>}>();
  for(const source of sources){
    if(source.authority!=='OPERATOR'||!source.currentRevisionId)continue;
    const hash=hashes.get(source.currentRevisionId);
    if(!hash)continue;
    const group=groups.get(hash)||{ids:[],categories:new Set<string>()};
    group.ids.push(source.id);
    for(const code of source.categoryCodes)if(code!=='GENERAL')group.categories.add(code);
    groups.set(hash,group);
  }
  return new Set([...groups.values()].filter(group=>group.ids.length>1&&group.categories.size>1).flatMap(group=>group.ids));
}

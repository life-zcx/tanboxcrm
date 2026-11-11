import fs from 'node:fs/promises';
import {prisma} from '../config/db';
import {publishFact} from './web.service';
async function main(){
  const input=JSON.parse(await fs.readFile(process.argv[2]||'data/web-reviewed-facts.json','utf8'));
  let published=0;const skipped:string[]=[];
  for(const fact of input.facts){
    const evidence=[];let valid=true;
    for(const e of fact.evidence){
      const source=await prisma.webKnowledgeSource.findUnique({where:{url:e.url}});
      const revision=source?.currentRevisionId?await prisma.webKnowledgeRevision.findUnique({where:{id:source.currentRevisionId}}):null;
      if(!revision||revision.contentHash!==e.expectedContentHash){valid=false;break;}
      evidence.push({revisionId:revision.id,quote:e.quote,locator:e.locator});
    }
    if(!valid){skipped.push(fact.key);continue;}
    const {evidence:_,...fields}=fact;
    await publishFact({...fields,evidence,reviewedBy:input.reviewedBy,reviewDueAt:new Date(new Date(input.reviewedAt+'T00:00:00+05:00').getTime()+14*86400000)});published++;
  }
  console.log(JSON.stringify({published,skipped}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

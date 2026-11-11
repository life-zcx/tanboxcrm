const path=require('node:path');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {prisma}=require('../backend/dist/config/db');
async function main(){
  const failed=await prisma.webKnowledgeSource.findMany({where:{status:'FETCH_ERROR',currentRevisionId:{not:null}},select:{id:true,currentRevisionId:true}});
  let restored=0;
  for(const source of failed){
    const revision=await prisma.webKnowledgeRevision.findUnique({where:{id:source.currentRevisionId},select:{quality:true}});
    if(!revision)continue;
    const status=revision.quality==='FULLTEXT'?'READY':revision.quality;
    const result=await prisma.webKnowledgeSource.updateMany({where:{id:source.id,status:'FETCH_ERROR',currentRevisionId:source.currentRevisionId},data:{status}});
    restored+=result.count;
  }
  console.log(JSON.stringify({examined:failed.length,restored}));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

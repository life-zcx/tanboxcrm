import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './config/db';
import { env } from './config/env';
import { normalizePhone, statusToStage } from './lib/validation';
import { imageFilename } from './lib/files';
export async function maintenance(){
  let cursor:string|undefined,normalized=0,deals=0;
  while(true){
    const page=await prisma.client.findMany({orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,name:true,phone:true,status:true,estimatedAmount:true,estimatedVolume:true,_count:{select:{deals:true}}}});
    if(!page.length)break;
    for(const client of page){
      await prisma.$transaction(async tx=>{
        const phone=normalizePhone(client.phone);
        if(phone&&phone!==client.phone){await tx.client.update({where:{id:client.id},data:{phone}});normalized++;}
        if(!client._count.deals){await tx.deal.create({data:{clientId:client.id,title:'Заказ: '+client.name,stage:statusToStage[client.status]||'NEW',amount:client.estimatedAmount,codesCount:client.estimatedVolume}});deals++;}
      });
    }
    cursor=page[page.length-1].id;
  }
  let quarantined=0;
  const references=new Set<string>();
  let chunkCursor:string|undefined;
  while(true){
    const chunks=await prisma.conversationChunk.findMany({select:{id:true,screenshotUrl:true},orderBy:{id:'asc'},take:100,...(chunkCursor?{cursor:{id:chunkCursor},skip:1}:{})});
    if(!chunks.length)break;
    chunks.forEach(c=>(c.screenshotUrl||'').split(',').forEach(u=>{const name=imageFilename(u);if(name)references.add(name);}));
    chunkCursor=chunks[chunks.length-1].id;
  }
  const root=path.resolve(env.UPLOADS_DIR),quarantine=path.join(root,'.quarantine');
  await fs.mkdir(quarantine,{recursive:true});
  for(const file of await fs.readdir(root,{withFileTypes:true})){
    if(!file.isFile()||references.has(file.name))continue;
    const source=path.resolve(root,file.name);
    if(path.dirname(source)!==root)throw new Error('Unsafe maintenance path');
    const info=await fs.stat(source);
    if(Date.now()-info.mtimeMs<3600_000)continue;
    await fs.rename(source,path.join(quarantine,Date.now()+'-'+file.name));quarantined++;
  }
  await prisma.authCode.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.adminUser.updateMany({where:{telegramChatId:{notIn:[...env.TELEGRAM_ALLOWED_USER_IDS]}},data:{role:'DISABLED'}});
  console.log(JSON.stringify({normalizedPhones:normalized,createdMissingDeals:deals,quarantinedFiles:quarantined,sessionsRevoked:true}));
}
if(require.main===module)maintenance().catch(()=>{console.error('Maintenance failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());

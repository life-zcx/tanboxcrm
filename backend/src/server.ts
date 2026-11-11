import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { env } from './config/env';
import { prisma } from './config/db';
import { createApp } from './app';
import { telegramBotService } from './bot/telegram.bot';
import { cleanupExpiredScreenshotDrafts } from './bot/screenshot-drafts.service';
import { flushFileDeletions } from './modules/clients/client-deletion.service';
import {seedWebRegistry,collectDue} from './knowledge/web.service';
async function main(){
  await prisma.$connect();
  const server=createApp().listen(env.PORT,env.HOST,()=>{console.log('TANBOX CRM API ready on port',env.PORT);void telegramBotService.start();});
  server.requestTimeout=70000;
  let stopping=false;
  const cleanup=setInterval(()=>{void prisma.$transaction([
    prisma.authCode.deleteMany({where:{expiresAt:{lt:new Date()}}}),
    prisma.authSession.deleteMany({where:{expiresAt:{lt:new Date()}}}),
  ]).catch(()=>console.warn('Session cleanup failed'));},60000);
  const fileCleanup=setInterval(()=>void flushFileDeletions().catch(()=>console.warn('File cleanup postponed')),30000);
  const draftCleanup=setInterval(()=>void cleanupExpiredScreenshotDrafts().catch(()=>console.warn('Draft cleanup postponed')),60000);
  fileCleanup.unref();
  draftCleanup.unref();
  void flushFileDeletions().catch(()=>console.warn('File cleanup postponed'));
  void cleanupExpiredScreenshotDrafts().catch(()=>console.warn('Draft cleanup postponed'));
  cleanup.unref();
  const knowledgeTimer=env.KNOWLEDGE_AUTO_COLLECT?setInterval(()=>void collectDue(5).catch(()=>console.warn('Knowledge monitoring postponed')),60000):undefined;
  knowledgeTimer?.unref();
  if(env.KNOWLEDGE_AUTO_COLLECT)void seedWebRegistry().then(()=>collectDue(3)).catch(()=>console.warn('Knowledge registry initialization postponed'));
  const stop=async()=>{
    if(stopping)return;stopping=true;clearInterval(cleanup);clearInterval(fileCleanup);clearInterval(draftCleanup);if(knowledgeTimer)clearInterval(knowledgeTimer);
    const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
    await telegramBotService.stop().catch(()=>{});
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await prisma.$disconnect();clearTimeout(deadline);
  };
  process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
}
main().catch(()=>{console.error('CRM startup failed: check database and required configuration');process.exitCode=1;});

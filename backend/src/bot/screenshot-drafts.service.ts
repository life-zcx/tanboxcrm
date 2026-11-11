import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { aiOrchestrator } from '../ai/ai.orchestrator';
import { ParsedConversationResult, parsedConversationSchema } from '../ai/gemini.service';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { deleteImages, imageFilename, SafeImage } from '../lib/files';

const draftLifetimeMs=30*60*1000;

async function removeDraftImages(urls:string[]) {
  for(const url of urls){
    const filename=imageFilename(url);
    if(!filename)continue;
    const used=await prisma.conversationChunk.findFirst({where:{screenshotUrl:{contains:url}},select:{id:true}});
    if(!used)await deleteImages([url]);
  }
}

export async function discardScreenshotDraft(id:string,userId?:string) {
  const draft=await prisma.screenshotDraft.findFirst({where:{id,...(userId?{telegramUserId:userId}:{})}});
  if(!draft)return false;
  await prisma.screenshotDraft.deleteMany({where:{id:draft.id}});
  await removeDraftImages(draft.imageUrls);
  return true;
}

export async function cleanupExpiredScreenshotDrafts() {
  const expired=await prisma.screenshotDraft.findMany({where:{expiresAt:{lte:new Date()}},select:{id:true},take:25});
  for(const draft of expired)await discardScreenshotDraft(draft.id);
  return expired.length;
}

export async function createTelegramScreenshotDraft(userId:string,images:SafeImage[],parsed:ParsedConversationResult,reviewToken:string,targetClientId?:string) {
  const previous=await prisma.screenshotDraft.findMany({where:{telegramUserId:userId},select:{id:true}});
  for(const draft of previous)await discardScreenshotDraft(draft.id,userId);
  return prisma.screenshotDraft.create({data:{
    telegramUserId:userId,targetClientId,imageUrls:images.map(image=>image.url),
    parsed:JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue,reviewToken,
    expiresAt:new Date(Date.now()+draftLifetimeMs),
  }});
}

export async function getTelegramScreenshotDraft(id:string,userId:string) {
  const draft=await prisma.screenshotDraft.findFirst({where:{id,telegramUserId:userId,expiresAt:{gt:new Date()}}});
  if(!draft)throw new AppError(404,'Черновик не найден или срок проверки истёк. Загрузите скриншоты снова.');
  return draft;
}

export async function updateTelegramScreenshotDraft(id:string,userId:string,update:(parsed:ParsedConversationResult)=>ParsedConversationResult) {
  const draft=await getTelegramScreenshotDraft(id,userId);
  const parsed=parsedConversationSchema.parse(update(parsedConversationSchema.parse(draft.parsed)));
  const result=await prisma.screenshotDraft.updateMany({where:{id,telegramUserId:userId,expiresAt:{gt:new Date()}},data:{parsed:JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue}});
  if(!result.count)throw new AppError(404,'Срок проверки истёк. Загрузите скриншоты снова.');
  return parsed;
}

export async function commitTelegramScreenshotDraft(id:string,userId:string) {
  const draft=await getTelegramScreenshotDraft(id,userId);
  const images:SafeImage[]=await Promise.all(draft.imageUrls.map(async url=>{
    const filename=imageFilename(url);
    if(!filename)throw new AppError(400,'Недопустимый путь к скриншоту');
    try{return {buffer:await fs.readFile(path.join(env.UPLOADS_DIR,filename)),mimeType:'image/jpeg',url};}
    catch{throw new AppError(404,'Скриншот черновика не найден. Загрузите его снова.');}
  }));
  const result=await aiOrchestrator.commitReviewedScreenshots({images,targetClientId:draft.targetClientId||undefined,reviewToken:draft.reviewToken,parsed:draft.parsed,source:'TELEGRAM_BOT'});
  await discardScreenshotDraft(id,userId);
  return result;
}

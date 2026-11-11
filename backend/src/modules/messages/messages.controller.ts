import { z } from 'zod';
import { createHash } from 'node:crypto';
import { aiOrchestrator } from '../../ai/ai.orchestrator';
import { knownTimestamp } from '../../ai/ai.orchestrator';
import { prisma } from '../../config/db';
import { AppError, route } from '../../lib/errors';
import { idSchema, text, pagination } from '../../lib/validation';
import { prepareImages, deleteImages } from '../../lib/files';
export const previewScreenshotHandler = route(async (req,res) => {
  const {targetClientId} = z.object({targetClientId:idSchema.optional()}).strict().parse(req.body);
  const files=(req.files as Express.Multer.File[]) || [];
  const images=await prepareImages(files.map(f=>({buffer:f.buffer,mimeType:f.mimetype})));
  try {
    const preview=await aiOrchestrator.previewScreenshots({images,targetClientId});
    res.json(preview);
  } finally { await deleteImages(images.map(i=>i.url)); }
});
export const commitScreenshotHandler = route(async (req,res) => {
  const {targetClientId,reviewToken,parsed} = z.object({targetClientId:idSchema.optional(),reviewToken:z.string().min(1).max(100),parsed:z.string().min(1).max(3_100_000)}).strict().parse(req.body);
  let parsedValue:unknown;
  try { parsedValue=JSON.parse(parsed); } catch { throw new AppError(400,'Некорректные данные переписки'); }
  const files=(req.files as Express.Multer.File[]) || [];
  const images=await prepareImages(files.map(f=>({buffer:f.buffer,mimeType:f.mimetype})));
  try {
    const result=await aiOrchestrator.commitReviewedScreenshots({images,targetClientId,reviewToken,parsed:parsedValue});
    if(result.duplicate)await deleteImages(images.map(i=>i.url));
    res.status(result.duplicate?200:201).json({result});
  } catch(error) { await deleteImages(images.map(i=>i.url)); throw error; }
});
export const ingestTextDialogueHandler = route(async (req,res) => {
  const {rawText,targetClientId} = z.object({rawText:text(50000),targetClientId:idSchema.optional()}).strict().parse(req.body);
  const result=await aiOrchestrator.ingestTextDialogue({rawText,targetClientId,source:'WEB_PANEL'});
  res.status(result.duplicate ? 200 : 201).json({result});
});
const manualMessagesSchema=z.object({
  requestId:idSchema,
  channel:z.enum(['WHATSAPP','TELEGRAM','OTHER']),
  note:z.string().trim().max(500).optional(),
  messages:z.array(z.object({
    sender:z.enum(['CLIENT','MANAGER']),
    content:z.string().trim().min(1).max(4000),
    time:z.iso.datetime({offset:true}).optional(),
  }).strict()).min(1).max(100),
}).strict().refine(value=>value.messages.reduce((size,message)=>size+message.content.length,0)<=200000,{message:'Слишком большой объём текста'});
export const addManualMessagesHandler=route(async(req,res)=>{
  const clientId=idSchema.parse(req.params.clientId),input=manualMessagesSchema.parse(req.body);
  const fingerprint=createHash('sha256').update('MANUAL_ENTRY:'+clientId+':'+input.requestId).digest('hex');
  const existing=await prisma.conversationChunk.findUnique({where:{fingerprint},include:{messages:{orderBy:{position:'asc'}},_count:{select:{messages:true}}}});
  if(existing){res.json({chunk:existing,duplicate:true});return;}
  try{
    const chunk=await prisma.$transaction(async tx=>{
      const client=await tx.client.findUnique({where:{id:clientId},select:{id:true}});
      if(!client)throw new AppError(404,'Клиент не найден');
      const saved=await tx.conversationChunk.create({data:{
        clientId,channel:input.channel,source:'MANUAL_ENTRY',fingerprint,
        summary:input.note||'Сообщения добавлены вручную',
        messages:{create:input.messages.map((message,position)=>({sender:message.sender,content:message.content,position,timestamp:knownTimestamp(message.time),originalTime:message.time||null}))},
      },include:{messages:{orderBy:{position:'asc'}},_count:{select:{messages:true}}}});
      await tx.client.update({where:{id:clientId},data:{lastContactAt:new Date()}});
      return saved;
    });
    res.status(201).json({chunk,duplicate:false});
  }catch(error:any){
    if(error?.code==='P2002'){
      const duplicate=await prisma.conversationChunk.findUnique({where:{fingerprint},include:{messages:{orderBy:{position:'asc'}},_count:{select:{messages:true}}}});
      if(duplicate){res.json({chunk:duplicate,duplicate:true});return;}
    }
    throw error;
  }
});
export const getClientConversations = route(async (req,res) => {
  const clientId=idSchema.parse(req.params.clientId),{skip,take}=pagination(req.query,20);
  const [conversations,total]=await prisma.$transaction([
    prisma.conversationChunk.findMany({where:{clientId},skip,take,orderBy:[{createdAt:'desc'},{id:'asc'}],include:{messages:{orderBy:[{position:'desc'},{id:'desc'}],take:100},_count:{select:{messages:true}}}}),
    prisma.conversationChunk.count({where:{clientId}}),
  ]);
  conversations.forEach(c=>c.messages.reverse());
  res.json({conversations,total,offset:skip,limit:take});
});
export const getChunkMessages = route(async(req,res)=>{
  const chunkId=idSchema.parse(req.params.chunkId),{skip,take}=pagination(req.query,100);
  const [messages,total]=await prisma.$transaction([
    prisma.message.findMany({where:{chunkId},skip,take,orderBy:[{position:'desc'},{id:'desc'}]}),
    prisma.message.count({where:{chunkId}}),
  ]);
  res.json({messages:messages.reverse(),total});
});

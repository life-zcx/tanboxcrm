import { z } from 'zod';
import { prisma } from '../../config/db';
import { TANBOX_KNOWLEDGE } from '../../ai/knowledge.service';
import { route } from '../../lib/errors';
import { text, idSchema, pagination } from '../../lib/validation';
export const getKnowledgeBase=route(async(req,res)=>{
  const {skip,take}=pagination(req.query);
  const [items,total]=await prisma.$transaction([prisma.knowledgeItem.findMany({skip,take,orderBy:[{createdAt:'desc'},{id:'asc'}]}),prisma.knowledgeItem.count()]);
  res.json({hardcodedKnowledge:TANBOX_KNOWLEDGE,customKnowledgeItems:items,total,offset:skip,limit:take});
});
export const createKnowledgeItem=route(async(req,res)=>{
  const data=z.object({category:z.enum(['TARIFFS','IS_MPT_RULES','OBJECTIONS','STICKERING','FAQ']).default('FAQ'),title:text(200),content:text(10000),reviewStatus:z.enum(['DRAFT','APPROVED']).default('DRAFT')}).strict().parse(req.body);
  const item=await prisma.knowledgeItem.create({data:{...data,reviewStatus:data.category==='IS_MPT_RULES'?'DRAFT':data.reviewStatus}}); res.status(201).json({item});
});
export const deleteKnowledgeItem=route(async(req,res)=>{await prisma.knowledgeItem.delete({where:{id:idSchema.parse(req.params.id)}}); res.json({success:true});});

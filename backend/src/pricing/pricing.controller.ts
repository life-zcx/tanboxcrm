import {z} from 'zod';
import {prisma} from '../config/db';
import {route,AppError} from '../lib/errors';
import {idSchema,pagination} from '../lib/validation';
import {loadPricing,saveQuote} from './pricing.service';
export const getPricing=route(async(_req,res)=>{res.json({snapshot:await loadPricing(),policy:{minimumProBatch:500,source:'Прайс TANBOX от 06.11.2026',sourceSha256:'7b9f6ed010e07b4f5e91f014d16d7fcb559098fe97778e4ab1f9c35ca8753f8a'}});});
export const createQuote=route(async(req,res)=>{
  const {clientId,input}=z.object({clientId:idSchema,input:z.unknown()}).strict().parse(req.body);
  res.status(201).json({quote:await saveQuote(clientId,input)});
});
export const listQuotes=route(async(req,res)=>{
  const clientId=idSchema.parse(req.query.clientId),{skip,take}=pagination(req.query,20);
  if(!await prisma.client.findUnique({where:{id:clientId},select:{id:true}}))throw new AppError(404,'Клиент не найден');
  const [quotes,total]=await prisma.$transaction([prisma.commercialQuote.findMany({where:{clientId},orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take}),prisma.commercialQuote.count({where:{clientId}})]);
  res.json({quotes,total,offset:skip,limit:take});
});
export const revokeQuote=route(async(req,res)=>{
  const id=idSchema.parse(req.params.id);
  z.object({}).strict().parse(req.body);
  const updated=await prisma.commercialQuote.updateMany({where:{id,revokedAt:null},data:{revokedAt:new Date()}});
  if(!updated.count&&!await prisma.commercialQuote.findUnique({where:{id},select:{id:true}}))throw new AppError(404,'Расчёт не найден');
  res.json({success:true});
});

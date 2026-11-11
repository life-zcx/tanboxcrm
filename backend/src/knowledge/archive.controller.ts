import path from 'node:path';
import {z} from 'zod';
import {prisma} from '../config/db';
import {route,AppError} from '../lib/errors';
import {pagination,idSchema} from '../lib/validation';
import {activeArchive,archiveDocument,sha256,verifyArchive} from './archive.service';
export const listLibrary=route(async(req,res)=>{
  const query=z.object({category:z.string().regex(/^[a-zA-Z_]+$/).optional(),language:z.enum(['ru','kz','en','mixed','ALL']).default('ru'),search:z.string().trim().max(200).default(''),kind:z.string().regex(/^[A-Z_]+$/).optional(),importId:idSchema.optional(),limit:z.unknown().optional(),offset:z.unknown().optional()}).strict().parse(req.query);
  const batch=query.importId?await prisma.knowledgeImport.findFirst({where:{id:query.importId,verifiedAt:{not:null}}}):await activeArchive();
  const versions=await prisma.knowledgeImport.findMany({where:{verifiedAt:{not:null}},orderBy:{createdAt:'desc'},select:{id:true,capturedAt:true,bundleHash:true,verifiedAt:true}});
  if(!batch){res.json({archive:null,documents:[],sources:[],versions,total:0});return;}
  const {skip,take}=pagination(req.query,20);
  const where={importId:batch.id,...(query.category?{categoryCodes:{has:query.category}}:{}),...(query.language==='ALL'?{}:{language:query.language}),...(query.kind?{kind:query.kind}:{}),...(query.search?{OR:[{title:{contains:query.search,mode:'insensitive' as const}},{content:{contains:query.search,mode:'insensitive' as const}}]}:{})};
  const [documents,total,sources]=await prisma.$transaction([
    prisma.knowledgeDocument.findMany({where,skip,take,orderBy:[{kind:'asc'},{title:'asc'},{id:'asc'}],select:{id:true,title:true,kind:true,language:true,categoryCodes:true,reviewStatus:true,issues:true,_count:{select:{passages:true}}}}),
    prisma.knowledgeDocument.count({where}),
    prisma.knowledgeSource.findMany({where:{importId:batch.id},orderBy:{path:'asc'},select:{id:true,path:true,sha256:true,byteLength:true}}),
  ]);
  res.json({archive:{id:batch.id,capturedAt:batch.capturedAt,bundleHash:batch.bundleHash,verifiedAt:batch.verifiedAt,manifest:batch.manifest},documents,sources,versions,total,offset:skip,limit:take});
});
export const getLibraryDocument=route(async(req,res)=>res.json({document:await archiveDocument(idSchema.parse(req.params.id))}));
export const downloadLibrarySource=route(async(req,res)=>{
  const source=await prisma.knowledgeSource.findUnique({where:{id:idSchema.parse(req.params.id)},include:{import:{select:{verifiedAt:true}}}});
  if(!source||!source.import.verifiedAt)throw new AppError(404,'Исходник не найден');
  if(source.data.length!==source.byteLength||sha256(source.data)!==source.sha256)throw new AppError(409,'Контрольная сумма исходника не совпадает');
  const filename=path.posix.basename(source.path.replaceAll('\\','/'));
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Disposition',"attachment; filename=source.txt; filename*=UTF-8''"+encodeURIComponent(filename));
  res.setHeader('X-Content-SHA256',source.sha256);res.send(source.data);
});
export const verifyLibrary=route(async(req,res)=>{
  const id=req.query.importId?idSchema.parse(req.query.importId):(await activeArchive())?.id;
  if(!id)throw new AppError(404,'База ещё не импортирована');
  const exists=await prisma.knowledgeImport.findUnique({where:{id}});if(!exists)throw new AppError(404,'Версия не найдена');
  res.json(await verifyArchive(id));
});
export const exportLibrary=route(async(req,res)=>{
  const id=req.query.importId?idSchema.parse(req.query.importId):(await activeArchive())?.id;
  if(!id)throw new AppError(404,'База ещё не импортирована');
  const batch=await prisma.knowledgeImport.findFirst({where:{id,verifiedAt:{not:null}},include:{sources:true,documents:true}});
  if(!batch)throw new AppError(404,'Версия не найдена');
  const report=await verifyArchive(id);if(!report.ok)throw new AppError(409,'Проверка целостности не пройдена');
  const {sourceOrder,documentOrder,...manifest}=batch.manifest as any;
  const bundle={format:1,bundleHash:batch.bundleHash,sourceRoot:batch.sourceRoot,capturedAt:batch.capturedAt.toISOString(),manifest,
    sources:sourceOrder.map((p:string)=>{const s=batch.sources.find(s=>s.path===p)!;return {path:s.path,sha256:s.sha256,byteLength:s.byteLength,data:s.data.toString('base64')};}),
    documents:documentOrder.map((key:string)=>{const d=batch.documents.find(d=>d.key===key)!;return {key:d.key,kind:d.kind,language:d.language,title:d.title,categoryCodes:d.categoryCodes,content:d.content,payload:d.payload,sha256:d.sha256,sourcePaths:d.sourcePaths,reviewStatus:d.reviewStatus,issues:d.issues};})};
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition','attachment; filename=tanbox-knowledge-'+batch.bundleHash.slice(0,12)+'.json');res.json(bundle);
});

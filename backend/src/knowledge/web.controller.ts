import {z} from 'zod';
import {prisma} from '../config/db';
import {route,AppError} from '../lib/errors';
import {idSchema} from '../lib/validation';
import {sha256} from './archive.service';
import {webOverview,collectDue,semanticHash} from './web.service';
import {searchWebPassages,knowledgeForReply} from './web.retrieval';
import {lookupMarkingList} from './web.list';
export const getWebOverview=route(async(_req,res)=>res.json(await webOverview()));
export const getWebDocument=route(async(req,res)=>{
  const revision=await prisma.webKnowledgeRevision.findUnique({where:{id:idSchema.parse(req.params.id)},include:{source:true,_count:{select:{passages:true}}}});
  if(!revision)throw new AppError(404,'Документ не найден');
  const {data,...document}=revision;res.json({document,integrity:sha256(data)===revision.sha256&&semanticHash(revision.text)===revision.contentHash});
});
export const getWebRaw=route(async(req,res)=>{
  const revision=await prisma.webKnowledgeRevision.findUnique({where:{id:idSchema.parse(req.params.id)}});
  if(!revision)throw new AppError(404,'Документ не найден');
  if(sha256(revision.data)!==revision.sha256)throw new AppError(409,'Контрольная сумма не совпадает');
  const ext=revision.data.subarray(0,5).toString()==='%PDF-'?'pdf':revision.contentType.includes('word')?'docx':revision.contentType.includes('json')?'json':'bin';
  res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename=knowledge-'+revision.sha256.slice(0,12)+'.'+ext);res.send(revision.data);
});
export const getWebSearch=route(async(req,res)=>{
  const {search,category}=z.object({search:z.string().trim().min(2).max(500),category:z.string().regex(/^[a-zA-Z_]+$/).optional()}).strict().parse(req.query);
  const [passages,knowledge]=await Promise.all([searchWebPassages(search,category),knowledgeForReply({query:search,category})]);
  res.json({passages,evidence:knowledge.evidence,category:knowledge.category,topic:knowledge.topic});
});
export const getMarkingListLookup=route(async(req,res)=>{
  const {code}=z.object({code:z.string().trim().min(4).max(20)}).strict().parse(req.query);
  res.json(await lookupMarkingList(code));
});
export const triggerWebCollection=route(async(_req,res)=>{
  // Source URLs come only from the controlled registry, never from this request.
  void collectDue(10).catch(()=>console.warn('Knowledge collection deferred'));
  res.status(202).json({queued:true});
});

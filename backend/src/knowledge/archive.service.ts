import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {prisma} from '../config/db';
import {AppError} from '../lib/errors';

export const activeImportKey='knowledge.activeImport';
export function canonical(value:any):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function documentDigest(d:any){
  return sha256(canonical({key:d.key,kind:d.kind,language:d.language,title:d.title,categoryCodes:d.categoryCodes,
    content:d.content,payload:d.payload,sourcePaths:d.sourcePaths,reviewStatus:d.reviewStatus,issues:d.issues}));
}
export function splitPassages(content:string,maxLength=2400){
  const result:string[]=[];
  for(let start=0;start<content.length;){
    let end=Math.min(start+maxLength,content.length);
    if(end<content.length){
      const newline=content.lastIndexOf('\n',end-1);
      if(newline>start+maxLength/2)end=newline+1;
      if(end>start&&/[\uD800-\uDBFF]/.test(content[end-1]))end--;
    }
    result.push(content.slice(start,end));start=end;
  }
  return result;
}
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const documentSchema=z.object({
  key:z.string().min(1),kind:z.string().min(1),language:z.string().min(1),title:z.string().min(1),
  categoryCodes:z.array(z.string()),content:z.string().min(1),payload:z.json(),sha256:hash,
  sourcePaths:z.array(z.string()).min(1),reviewStatus:z.literal('SOURCE'),issues:z.array(z.string()),
}).strict();
const bundleSchema=z.object({
  format:z.literal(1),bundleHash:hash,capturedAt:z.iso.datetime(),sourceRoot:z.string(),
  manifest:z.object({scope:z.string(),categories:z.array(z.object({code:z.string(),title:z.string(),aliases:z.array(z.string())})),
    coverage:z.object({categories:z.number().int(),articles:z.number().int(),sourceFiles:z.number().int(),sourceBytes:z.number().int(),documents:z.number().int(),contentCharacters:z.number().int()}).passthrough(),excluded:z.array(z.string())}),
  sources:z.array(z.object({path:z.string().min(1),sha256:hash,byteLength:z.number().int().nonnegative(),data:z.string()}).strict()),
  documents:z.array(documentSchema),
}).strict();
export type KnowledgeBundle=z.infer<typeof bundleSchema>;
export function validateBundle(input:unknown){
  const bundle=bundleSchema.parse(input),paths=new Set(bundle.sources.map(s=>s.path)),keys=new Set(bundle.documents.map(d=>d.key));
  const coverage=bundle.manifest.coverage;
  if(paths.size!==bundle.sources.length||keys.size!==bundle.documents.length)throw new Error('Duplicate source or document');
  if(coverage.sourceFiles!==paths.size||coverage.documents!==keys.size||coverage.categories!==bundle.manifest.categories.length)throw new Error('Incomplete manifest');
  if(new Set(bundle.manifest.categories.map(c=>c.code)).size!==coverage.categories)throw new Error('Duplicate category');
  for(const source of bundle.sources){
    const data=Buffer.from(source.data,'base64');
    if(data.length!==source.byteLength||sha256(data)!==source.sha256)throw new Error('Source checksum mismatch: '+source.path);
  }
  for(const doc of bundle.documents){
    if(documentDigest(doc)!==doc.sha256)throw new Error('Document checksum mismatch: '+doc.key);
    if(doc.sourcePaths.some(p=>!paths.has(p)))throw new Error('Missing document source: '+doc.key);
  }
  if(coverage.sourceBytes!==bundle.sources.reduce((n,s)=>n+s.byteLength,0)||coverage.contentCharacters!==bundle.documents.reduce((n,d)=>n+d.content.length,0))throw new Error('Coverage mismatch');
  const expected=sha256(canonical({sources:bundle.sources.map(s=>({path:s.path,sha256:s.sha256})),documents:bundle.documents.map(d=>({key:d.key,sha256:d.sha256})),manifest:bundle.manifest}));
  if(expected!==bundle.bundleHash)throw new Error('Bundle checksum mismatch');
  for(const c of bundle.manifest.categories)for(const language of ['ru','kz','en']){
    if(!bundle.documents.some(d=>d.kind==='CATEGORY'&&d.language===language&&d.categoryCodes.includes(c.code)))throw new Error('Missing category language: '+c.code+':'+language);
  }
  for(const language of ['ru','kz','en'])if(bundle.documents.filter(d=>d.kind==='ARTICLE'&&d.language===language).length!==coverage.articles)throw new Error('Missing article language: '+language);
  if(bundle.documents.filter(d=>d.kind==='ORIGINAL').length!==coverage.articles)throw new Error('Missing original article');
  return bundle;
}
export async function verifyArchive(importId:string){
  const batch=await prisma.knowledgeImport.findUniqueOrThrow({where:{id:importId},include:{sources:true,documents:{include:{passages:{orderBy:{position:'asc'}}}}}});
  const sources=batch.sources.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const manifest=batch.manifest as any,coverage=manifest.coverage;
  const failures:string[]=[];
  for(const s of sources)if(s.data.length!==s.byteLength||sha256(s.data)!==s.sha256)failures.push('source:'+s.path);
  let passages=0;
  for(const d of batch.documents){
    passages+=d.passages.length;
    if(documentDigest(d)!==d.sha256)failures.push('document:'+d.key);
    if(d.passages.map(p=>p.content).join('')!==d.content||d.passages.some((p,i)=>p.position!==i))failures.push('passages:'+d.key);
    if(d.sourcePaths.some(p=>!sources.some(s=>s.path===p)))failures.push('references:'+d.key);
  }
  if(sources.length!==coverage.sourceFiles||batch.documents.length!==coverage.documents||sources.reduce((n,s)=>n+s.byteLength,0)!==coverage.sourceBytes||batch.documents.reduce((n,d)=>n+d.content.length,0)!==coverage.contentCharacters)failures.push('counts');
  // Original ordering is in the manifest, independent of PostgreSQL row order.
  const orderedSources=(manifest.sourceOrder as string[]).map(p=>sources.find(s=>s.path===p));
  const orderedDocs=(manifest.documentOrder as string[]).map(k=>batch.documents.find(d=>d.key===k));
  if(orderedSources.some(s=>!s)||orderedDocs.some(d=>!d))failures.push('order');
  else {
    const {sourceOrder,documentOrder,...originalManifest}=manifest;
    const reconstructed=sha256(canonical({sources:orderedSources.map(s=>({path:s!.path,sha256:s!.sha256})),documents:orderedDocs.map(d=>({key:d!.key,sha256:d!.sha256})),manifest:originalManifest}));
    if(reconstructed!==batch.bundleHash)failures.push('bundle');
  }
  for(const c of manifest.categories)for(const lang of ['ru','kz','en'])if(!batch.documents.some(d=>d.kind==='CATEGORY'&&d.language===lang&&d.categoryCodes.includes(c.code)))failures.push('category:'+c.code+':'+lang);
  return {importId,bundleHash:batch.bundleHash,ok:failures.length===0,failures,sourceFiles:sources.length,sourceBytes:sources.reduce((n,s)=>n+s.byteLength,0),documents:batch.documents.length,passages,contentCharacters:batch.documents.reduce((n,d)=>n+d.content.length,0),categories:manifest.categories.length,checkedAt:new Date().toISOString()};
}
export async function importArchive(input:unknown){
  const bundle=validateBundle(input);
  let batch=await prisma.knowledgeImport.findUnique({where:{bundleHash:bundle.bundleHash}});
  if(!batch){
    batch=await prisma.$transaction(async tx=>{
      const created=await tx.knowledgeImport.create({data:{bundleHash:bundle.bundleHash,sourceRoot:bundle.sourceRoot,capturedAt:new Date(bundle.capturedAt),manifest:{...bundle.manifest,sourceOrder:bundle.sources.map(s=>s.path),documentOrder:bundle.documents.map(d=>d.key)} as Prisma.InputJsonValue}});
      for(const source of bundle.sources)await tx.knowledgeSource.create({data:{importId:created.id,path:source.path,sha256:source.sha256,byteLength:source.byteLength,data:Buffer.from(source.data,'base64')}});
      for(const doc of bundle.documents){
        const saved=await tx.knowledgeDocument.create({data:{...doc,payload:doc.payload as Prisma.InputJsonValue,importId:created.id}});
        await tx.knowledgePassage.createMany({data:splitPassages(doc.content).map((content,position)=>({documentId:saved.id,position,content}))});
      }
      return created;
    },{maxWait:10000,timeout:120000});
  }
  const report=await verifyArchive(batch.id);
  if(!report.ok)throw new Error('Stored knowledge archive did not pass integrity verification: '+report.failures.join(','));
  await prisma.$transaction([
    prisma.knowledgeImport.update({where:{id:batch.id},data:{verifiedAt:new Date()}}),
    prisma.systemSetting.upsert({where:{key:activeImportKey},create:{key:activeImportKey,value:batch.id,description:'Verified complete source import for the knowledge library'},update:{value:batch.id}}),
  ]);
  return report;
}
export async function activeArchive(){
  const setting=await prisma.systemSetting.findUnique({where:{key:activeImportKey}});
  return setting?prisma.knowledgeImport.findFirst({where:{id:setting.value,verifiedAt:{not:null}}}):null;
}
export async function archiveDocument(id:string){
  const document=await prisma.knowledgeDocument.findUnique({where:{id},include:{import:{select:{capturedAt:true,bundleHash:true,verifiedAt:true}}}});
  if(!document||!document.import.verifiedAt)throw new AppError(404,'Материал не найден');
  const sources=await prisma.knowledgeSource.findMany({where:{importId:document.importId,path:{in:document.sourcePaths}},select:{id:true,path:true,sha256:true,byteLength:true}});
  return {...document,sources};
}

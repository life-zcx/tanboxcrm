const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'backups');
const directory=path.resolve(process.argv[2]||'');
const relative=path.relative(base,directory);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Specify a backup directory inside this workspace/backups');
const dump=path.join(directory,'database.dump'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
const name='tanbox-web-restore-'+process.pid;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',...options});
const sql=query=>docker(['exec','-i',name,'psql','-U','tanbox_crm','-d','tanbox_crm','-v','ON_ERROR_STOP=1','-At'],{input:query}).trim();
async function main(){
 const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(dump))hash.update(chunk);
 if(hash.digest('hex').toUpperCase()!==manifest.databaseSha256.toUpperCase())throw Error('Backup checksum mismatch');
 let started=false;
 try{
  // No published ports: this temporary database is reachable only through docker exec.
  const password=crypto.randomBytes(32).toString('hex');
  docker(['run','--rm','-d','--name',name,'-e','POSTGRES_USER=tanbox_crm','-e','POSTGRES_DB=tanbox_crm','-e','POSTGRES_PASSWORD='+password,'postgres:15-alpine']);started=true;
  let ready=false;for(let i=0;i<30;i++){
   if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','tanbox_crm'],{stdio:'ignore'}).status===0){ready=true;break;}
   await new Promise(r=>setTimeout(r,1000));
  }
  if(!ready)throw Error('Restore database did not start');
  docker(['cp',dump,name+':/tmp/restore.dump']);
  docker(['exec',name,'pg_restore','-U','tanbox_crm','-d','tanbox_crm','--single-transaction','--exit-on-error','/tmp/restore.dump']);
  docker(['run','--rm','--network','container:'+name,'-e','DATABASE_URL=postgresql://tanbox_crm:'+password+'@127.0.0.1:5432/tanbox_crm','tanbox-crm-migrate']);
  if(sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='CommercialQuote';`)!=='1')throw Error('Restored schema did not migrate to commercial quotes');
  const report=JSON.parse(sql(`WITH pieces AS (
   SELECT "revisionId",string_agg(content,'' ORDER BY position) AS combined,COUNT(*) AS count,MIN(position) AS first,MAX(position) AS last
   FROM "WebKnowledgePassage" GROUP BY "revisionId"
  ) SELECT json_build_object(
   'revisions',(SELECT COUNT(*) FROM "WebKnowledgeRevision"),
   'originalBytes',(SELECT SUM(octet_length(data)) FROM "WebKnowledgeRevision"),
   'badOriginals',(SELECT COUNT(*) FROM "WebKnowledgeRevision" WHERE encode(sha256(data),'hex')<>sha256),
   'badPassages',(SELECT COUNT(*) FROM "WebKnowledgeRevision" r LEFT JOIN pieces p ON p."revisionId"=r.id
      WHERE COALESCE(p.combined,'')<>r.text OR p.count>0 AND (p.first<>0 OR p.last+1<>p.count)),
   'facts',(SELECT COUNT(*) FROM "WebKnowledgeFact" WHERE status='APPROVED'),
   'archiveDocuments',(SELECT COUNT(*) FROM "KnowledgeDocument"),
   'badArchiveOriginals',(SELECT COUNT(*) FROM "KnowledgeSource" WHERE encode(sha256(data),'hex')<>sha256)
  );`));
  if(report.revisions<310||report.facts<17||report.archiveDocuments<172||report.badOriginals||report.badPassages||report.badArchiveOriginals)throw Error('Restored knowledge integrity check failed: '+JSON.stringify(report));
  Object.assign(report,{backup:path.relative(root,directory),backupChecksumValid:true,restoredInIsolatedDatabase:true,migratedToCurrentSchema:true,checkedAt:new Date().toISOString()});
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/web-backup-restore.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }finally{if(started)docker(['stop',name]);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

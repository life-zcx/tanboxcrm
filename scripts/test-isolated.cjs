const {execFileSync,spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..'),backend=path.join(root,'backend');
const name='tanbox-crm-regression-'+process.pid,password=randomBytes(32).toString('hex');
let started=false;
async function main(){
  try{
    execFileSync('docker',['run','--rm','-d','--name',name,'-e','POSTGRES_USER=tanbox_crm','-e','POSTGRES_DB=tanbox_crm','-e','POSTGRES_PASSWORD='+password,'-p','127.0.0.1::5432','postgres:15-alpine'],{stdio:'pipe'});started=true;
    const mapping=execFileSync('docker',['port',name,'5432/tcp'],{encoding:'utf8'}).trim();
    const port=mapping.split(':').pop();
    let ready=false;
    for(let i=0;i<30;i++){
      const check=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','tanbox_crm'],{stdio:'ignore'});
      if(check.status===0){ready=true;break;}
      await new Promise(r=>setTimeout(r,1000));
    }
    if(!ready)throw new Error('Isolated PostgreSQL did not become ready');
    require('./check-legacy-order.cjs')(name,backend);
    const environment={...process.env,DATABASE_URL:'postgresql://tanbox_crm:'+password+'@127.0.0.1:'+port+'/tanbox_crm?schema=public',JWT_SECRET:randomBytes(48).toString('hex'),TELEGRAM_ALLOWED_USER_IDS:'8563274673',TELEGRAM_BOT_TOKEN:'123456789:test-placeholder-no-network',TELEGRAM_POLLING:'false',GOOGLE_GEMINI_API_KEY:'',OPENAI_API_KEY:'',CRM_TEST_DATABASE:'1'};
    const prisma=path.join(backend,'node_modules/prisma/build/index.js');
    execFileSync(process.execPath,[prisma,'migrate','deploy'],{cwd:backend,env:environment,stdio:'inherit'});
    const tsx=require.resolve('tsx/cli',{paths:[backend]});
    const testFiles=fs.readdirSync(path.join(backend,'test')).filter(f=>f.endsWith('.test.ts'));
    // Test files share one isolated database and some assert global row counts.
    const result=spawnSync(process.execPath,[tsx,'--test','--test-concurrency=1',...testFiles.map(f=>'test/'+f)],{cwd:backend,env:environment,stdio:'inherit'});
    process.exitCode=result.status||0;
    if(result.status!==0)return;
    const sql=(database,text)=>execFileSync('docker',['exec','-i',name,'psql','-U','tanbox_crm','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8'}).trim();
    const counts=database=>sql(database,'SELECT json_build_array((SELECT COUNT(*) FROM "Client"),(SELECT COUNT(*) FROM "ConversationChunk"),(SELECT COUNT(*) FROM "Deal"),(SELECT COUNT(*) FROM "KnowledgeImport"),(SELECT COUNT(*) FROM "KnowledgeDocument"),(SELECT COUNT(*) FROM "KnowledgePassage"),(SELECT md5(string_agg(encode(data,\'hex\'),\'\' ORDER BY path)) FROM "KnowledgeSource"));');
    const commercial=database=>sql(database,`SELECT json_build_array((SELECT COUNT(*) FROM "CommercialQuote"),(SELECT md5(string_agg(to_jsonb(q)::text,'' ORDER BY q.id)) FROM "CommercialQuote" q),(SELECT md5(string_agg("commercialEvidence"::text,'' ORDER BY id)) FROM "AISuggestion"));`);
    const original=counts('tanbox_crm'),originalCommercial=commercial('tanbox_crm');
    if(Number(sql('tanbox_crm','SELECT COUNT(*) FROM "CommercialQuote";'))<1)throw new Error('A complete commercial quote fixture is required for backup/restore');
    execFileSync('docker',['exec',name,'pg_dump','-U','tanbox_crm','-Fc','-f','/tmp/regression.dump','tanbox_crm']);
    execFileSync('docker',['exec',name,'createdb','-U','tanbox_crm','tanbox_restore']);
    execFileSync('docker',['exec',name,'pg_restore','-U','tanbox_crm','-d','tanbox_restore','--single-transaction','--exit-on-error','/tmp/regression.dump']);
    if(counts('tanbox_restore')!==original)throw new Error('Restored row counts differ');
    if(commercial('tanbox_restore')!==originalCommercial)throw new Error('Restored commercial quotes or AI price provenance differ');
    const before=sql('tanbox_restore','SELECT COUNT(*) FROM "AuthCode";');
    const failed=spawnSync('docker',['exec','-i',name,'psql','-U','tanbox_crm','-d','tanbox_restore','-v','ON_ERROR_STOP=1'],{input:'BEGIN; DELETE FROM "AuthCode"; SELECT 1/0; COMMIT;',encoding:'utf8'});
    if(failed.status===0||sql('tanbox_restore','SELECT COUNT(*) FROM "AuthCode";')!==before)throw new Error('Failed restore did not roll back');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    const testsPassed=testFiles.reduce((n,file)=>n+(fs.readFileSync(path.join(backend,'test',file),'utf8').match(/^\s*test\(/gm)||[]).length,0);
    fs.writeFileSync(path.join(root,'test-results/backend.json'),JSON.stringify({testsPassed,legacyOrderRecovery:'passed',knowledgeArchive:'full content and checksums verified',backupRestore:'row counts and original knowledge bytes preserved',sqlError:'nonzero exit and transaction rolled back'},null,2));
    console.log('Backup/restore and SQL-error rollback checks passed.');
  }finally{if(started)execFileSync('docker',['stop',name],{stdio:'ignore'});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

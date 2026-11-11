const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

module.exports=function checkLegacyOrder(container,backend){
  execFileSync('docker',['exec',container,'createdb','-U','tanbox_crm','legacy_order_check']);
  const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-U','tanbox_crm','-d','legacy_order_check','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8'}).trim();
  for(const migration of ['202611090001_baseline','202611090002_security'])sql(fs.readFileSync(path.join(backend,'prisma/migrations',migration,'migration.sql'),'utf8'));
  const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  const messages=[{sender:'CLIENT',content:'Первое сообщение',time:'23:59'},{sender:'MANAGER',content:'Ответ после полуночи',time:'00:01'},{sender:'CLIENT',content:'Последнее сообщение',time:'00:02'}];
  sql(`BEGIN;
    INSERT INTO "Client" (id,name,"updatedAt") VALUES ('legacy-client','Legacy',NOW());
    INSERT INTO "ConversationChunk" (id,"clientId","extractedInfo") VALUES ('legacy-chunk','legacy-client',${quote(JSON.stringify({messages}))}),('broken-chunk','legacy-client','{broken');
    ${messages.map((m,i)=>`INSERT INTO "Message" (id,"chunkId",sender,content,"createdAt") VALUES ('reverse-id-${3-i}','legacy-chunk',${quote(m.sender)},${quote(m.content)},NOW());`).join('\n')}
    INSERT INTO "Message" (id,"chunkId",sender,content,"createdAt") VALUES ('broken-message','broken-chunk','CLIENT','Recover without JSON',NOW());
    COMMIT;`);
  sql(fs.readFileSync(path.join(backend,'prisma/migrations/202611100003_message_order_and_deletion/migration.sql'),'utf8'));
  const recovered=JSON.parse(sql('SELECT json_agg(json_build_object(\'content\',content,\'time\',"originalTime",\'position\',position) ORDER BY position) FROM "Message" WHERE "chunkId"=\'legacy-chunk\';'));
  assert.deepEqual(recovered,messages.map((m,i)=>({content:m.content,time:m.time,position:i})));
  assert.equal(sql('SELECT position FROM "Message" WHERE id=\'broken-message\';'),'0');
  console.log('Legacy message order recovered; malformed legacy JSON preserved safely.');
};

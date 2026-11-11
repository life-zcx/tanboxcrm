// Local analysis only. Never writes message bodies, names, phones or contacts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const directory=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.statSync(directory).isDirectory())throw Error('Provide the conversation directory');
const files=fs.readdirSync(directory).filter(f=>/^\d+\.md$/i.test(f)).sort((a,b)=>parseInt(a)-parseInt(b));
const records=files.map(file=>{
 const data=fs.readFileSync(path.join(directory,file)),text=data.toString('utf8');
 const messages=[...text.matchAll(/^\[(\d{1,2}:\d{2})\]\s+\*\*(.+?):\*\*\s*(.*)$/gm)];
 return {file,sha256:crypto.createHash('sha256').update(data).digest('hex'),bytes:data.length,
  dates:[...text.matchAll(/^## (.+)$/gm)].map(m=>m[1].trim()),
  messages:messages.length,clientMessages:messages.filter(m=>m[2]!=='Вы').length,managerMessages:messages.filter(m=>m[2]==='Вы').length,
  documents:(text.match(/\[Документ\]/g)||[]).length,voice:(text.match(/\[Голосовое сообщение\]/g)||[]).length,calls:(text.match(/\[Звонок\]/g)||[]).length,
  missingUnsupportedMessage:/версия WhatsApp Web не поддерживает/.test(text),
  contentAvailable:messages.length>0,ownerReportedOutcome:messages.length?'NO_RESPONSE_AFTER_LAST_OUTREACH':'INSUFFICIENT_CONTENT'};
});
const report={analyzedAt:new Date().toISOString(),method:'LOCAL_READ_ONLY_NO_EXTERNAL_MODEL',sourceFileCount:records.length,meaningfulConversations:records.filter(r=>r.contentAvailable).length,
  limitations:['Only the text present in files was analyzed.','Attachments, voice messages and calls have no supplied content.','No response reported by owner; no paid or lost outcomes inferred.'],records};
const target=path.resolve(__dirname,'../docs/knowledge/client-sample-inventory.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({files:records.length,meaningfulConversations:report.meaningfulConversations,messages:records.reduce((n,r)=>n+r.messages,0),output:path.relative(process.cwd(),target)},null,2));

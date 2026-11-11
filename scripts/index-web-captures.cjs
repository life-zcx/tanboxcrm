const fs=require('node:fs'),readline=require('node:readline');
async function main(){
 const rows=[];fs.mkdirSync('test-results/web-core',{recursive:true});
 for await(const line of readline.createInterface({input:fs.createReadStream('backend/data/web-captures.ndjson'),crlfDelay:Infinity})){
  if(!line.trim())continue;const row=JSON.parse(line);
  rows.push({url:row.seed.url,title:row.seed.title,quality:row.capture?.quality||row.error,bytes:row.capture?Buffer.from(row.capture.data,'base64').length:0,pages:row.capture?.metadata.pages,characters:row.capture?.text.length});
  if(row.capture&&(/\/api\/documents/.test(row.seed.url)||/\/business\/product\//.test(row.seed.url)||row.seed.authority==='GOVERNMENT')){
   const key=row.seed.url.includes('/api/documents/')?'law-'+row.seed.url.match(/documents\/(\d+)/)[1]:row.seed.url.includes('/product/')?row.seed.url.split('/').pop():'gov-'+(row.seed.url.match(/\d{5,}/)||[rows.length])[0];
   fs.writeFileSync('test-results/web-core/'+key+'.txt',row.capture.text,'utf8');
  }
 }
 fs.writeFileSync('test-results/web-index.json',JSON.stringify(rows,null,2));
 console.log(JSON.stringify({sources:rows.length,totalBytes:rows.reduce((n,r)=>n+r.bytes,0),notFullText:rows.filter(r=>r.quality!=='FULLTEXT'),largest:rows.sort((a,b)=>b.bytes-a.bytes).slice(0,4)},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

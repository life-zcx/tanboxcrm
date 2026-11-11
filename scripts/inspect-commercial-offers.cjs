// Read user-supplied PDFs locally. Full extracted texts remain in ignored
// test-results, outside the public knowledge corpus and Docker build context.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PDFParse}=require('../backend/node_modules/pdf-parse');
const directory=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.statSync(directory).isDirectory())throw Error('Provide the PDF directory');
const output=path.resolve(__dirname,'../test-results/commercial-offers');fs.mkdirSync(output,{recursive:true});
async function main(){
 const inventory=[];let index=0;
 for(const filename of fs.readdirSync(directory).filter(f=>/\.pdf$/i.test(f)).sort()){
  const data=fs.readFileSync(path.join(directory,filename)),sha256=crypto.createHash('sha256').update(data).digest('hex');
  const duplicate=inventory.find(r=>r.sha256===sha256);
  if(duplicate){inventory.push({filename,sha256,bytes:data.length,duplicateOf:duplicate.filename,textFile:duplicate.textFile});continue;}
  const parser=new PDFParse({data});
  try{
   const text=await parser.getText(),textFile=String(++index)+'.txt';
   fs.writeFileSync(path.join(output,textFile),text.text,'utf8');
   const images=await parser.getScreenshot({desiredWidth:1100,imageBuffer:true,imageDataUrl:false});
   for(const image of images.pages)fs.writeFileSync(path.join(output,String(index)+'-'+image.pageNumber+'.png'),image.data);
   inventory.push({filename,sha256,bytes:data.length,pages:text.total,characters:text.text.length,textFile,pageCharacters:text.pages.map(p=>({page:p.num,characters:p.text.replace(/\s/g,'').length}))});
  }finally{await parser.destroy();}
 }
 fs.writeFileSync(path.join(output,'inventory.json'),JSON.stringify({extractedAt:new Date().toISOString(),localOnly:true,documents:inventory},null,2));
 console.log(JSON.stringify(inventory,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

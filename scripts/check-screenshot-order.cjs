const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const sharp=require('../backend/node_modules/sharp');
const {geminiService}=require('../backend/dist/ai/gemini.service');
const {prisma}=require('../backend/dist/config/db');
const lines=[
 ['Client: Need marking for 100 pairs of shoes. [23:58]','Manager: What is the delivery date? [23:59]'],
 ['Manager: What is the delivery date? [23:59]','Client: Tomorrow, please. [00:01]','Manager: Please send the company BIN. [00:02]'],
];
async function main(){
  const images=[];
  for(const messages of lines){
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="620"><rect width="1500" height="620" fill="white"/><text x="35" y="70" font-family="Arial" font-size="40">WhatsApp conversation: Alexey</text>'+messages.map((text,i)=>'<text x="35" y="'+(190+i*130)+'" font-family="Arial" font-size="34">'+text+'</text>').join('')+'</svg>';
    images.push({buffer:await sharp(Buffer.from(svg)).png().toBuffer(),mimeType:'image/png'});
  }
  try{
    const parsed=await geminiService.parseScreenshotsBatch(images);
    assert.equal(parsed.messages.length,4,'The repeated boundary message must appear once');
    const times=parsed.messages.map(m=>m.time?.match(/\b(?:23:58|23:59|00:01|00:02)\b/)?.[0]);
    assert.deepEqual(times,['23:58','23:59','00:01','00:02']);
    const result={model:geminiService.getStatus().model,screenshots:2,messages:4,times,midnightOrderPreserved:true,boundaryDuplicateRemoved:true};
    fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'../test-results/screenshot-order.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await prisma.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

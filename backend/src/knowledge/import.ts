import fs from 'node:fs/promises';
import path from 'node:path';
import {prisma} from '../config/db';
import {importArchive,verifyArchive,activeArchive} from './archive.service';
async function main(){
  if(process.argv.includes('--verify')){
    const batch=await activeArchive();if(!batch)throw new Error('No active archive');
    const report=await verifyArchive(batch.id);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
  }else{
    const filename=process.argv[2]||path.join(process.cwd(),'data/knowledge-bundle.json');
    console.log(JSON.stringify(await importArchive(JSON.parse(await fs.readFile(filename,'utf8'))),null,2));
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

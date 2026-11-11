import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const execute=promisify(execFile);
export async function ocrPdf(data:Buffer,pages:{num:number;text:string}[],missing:number[]){
  if(missing.length>50)return null;
  try{await execute('tesseract',['--version'],{timeout:5000});}catch{return null;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tanbox-knowledge-ocr-'));
  try{
    const filename=path.join(directory,'source.pdf');await fs.writeFile(filename,data);
    const result=new Map(pages.map(p=>[p.num,p.text]));
    for(const page of missing){
      const prefix=path.join(directory,'page-'+page);
      await execute('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-r','160','-png',filename,prefix],{timeout:30000,maxBuffer:2*1024*1024});
      const {stdout}=await execute('tesseract',[prefix+'.png','stdout','-l','rus+kaz+eng','--psm','3'],{timeout:45000,maxBuffer:8*1024*1024});
      result.set(page,stdout);
    }
    return [...result].sort(([a],[b])=>a-b).map(([num,text])=>text+'\n\n-- '+num+' of '+pages.length+' --\n\n').join('');
  }finally{
    const resolved=path.resolve(directory);
    if(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('tanbox-knowledge-ocr-'))await fs.rm(resolved,{recursive:true,force:true});
  }
}

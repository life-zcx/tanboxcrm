const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function main(){
 const url='https://tanbox.kz/api/tariffs',response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Public pricing HTTP '+response.status);
 const data=Buffer.from(await response.arrayBuffer()),json=JSON.parse(data.toString('utf8'));
 const output=path.join(__dirname,'../test-results/commercial-offers');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'public-pricing.json'),data);
 const metadata={url,fetchedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(data).digest('hex')};
 fs.writeFileSync(path.join(output,'public-pricing-metadata.json'),JSON.stringify(metadata,null,2));
 console.log(JSON.stringify({...metadata,tariffs:(json.tariffs||[]).map(t=>({code:t.code,priceRetail:t.priceRetail,priceWholesale:t.priceWholesale,priceLargeWholesale:t.priceLargeWholesale})),pricingSettings:json.pricingSettings},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

// Independent arithmetic audit against the supplied PDF texts and a captured
// public pricing response. Does not change rates, discounts or original PDFs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.join(__dirname,'../test-results/commercial-offers');
const read=name=>fs.readFileSync(path.join(directory,name),'utf8');
const source=JSON.parse(read('inventory.json')),pricing=JSON.parse(read('public-pricing.json')),pricingSource=JSON.parse(read('public-pricing-metadata.json'));
if(process.argv[2])for(const document of source.documents){
 const original=fs.readFileSync(path.join(path.resolve(process.argv[2]),document.filename));
 assert.equal(require('node:crypto').createHash('sha256').update(original).digest('hex'),document.sha256,'Original PDF changed');
}
const amount=text=>Number(text.replace(/\s/g,'').replace(',','.'));
const money=text=>[...text.matchAll(/(\d[\d\s]*[.,]?\d*)\s*₸/g)].map(m=>amount(m[1]));
const first=read('1.txt'),list=read('2.txt'),revised=read('3.txt'),equipment=read('4.txt');
assert.deepEqual(money(first),[9000,795000,79900,883900]);
assert.deepEqual(money(revised),[9000,795000,79900,883900,133900,750000]);
assert.deepEqual(money(equipment),[145000,15000,10000,15000,60000,245000]);
const quantity=amount(first.match(/•\s*([\d ]+)\s*единиц/)[1]);
const cards=Number(first.match(/•\s*(\d+)\s*наименований/)[1]);
const tariff=pricing.tariffs.find(t=>t.code==='STANDARD'),settings=pricing.pricingSettings;
const bands=[Math.min(quantity,settings.volumeTier1),Math.max(0,Math.min(quantity-settings.volumeTier1,settings.volumeTier2-settings.volumeTier1)),Math.max(0,quantity-settings.volumeTier2)];
const rates=[tariff.priceRetail,tariff.priceWholesale,tariff.priceLargeWholesale].map(Number);
const marking=bands.reduce((sum,count,index)=>sum+count*rates[index],0),cardTotal=cards*Number(settings.cardFullPackagePrice),setup=Number(settings.outsourcingOneTimePrice);
const base=marking+cardTotal+setup,discount=base-750000,percent=discount/base*100;
assert.equal(marking,795000);assert.equal(cardTotal,9000);assert.equal(setup,79900);assert.equal(base,883900);
assert.equal(Math.round(percent*100)/100,amount(revised.match(/([\d]+[.,]\d+)%/)[1]));
assert.equal(money(equipment).slice(0,-1).reduce((a,b)=>a+b,0),money(equipment).at(-1));
assert.deepEqual(money(list),pricing.tariffs.map(t=>Math.min(Number(t.priceRetail),Number(t.priceWholesale),Number(t.priceLargeWholesale))));
assert.equal(source.documents.length,5);assert.equal(new Set(source.documents.map(d=>d.sha256)).size,4);
const report={checkedAt:new Date().toISOString(),status:'COMMERCIAL_DOCUMENT_REVIEW_NOT_GENERAL_PRICE_APPROVAL',pricingSource,
 documents:source.documents.map(({filename,sha256,bytes,duplicateOf})=>({filename,sha256,bytes,duplicateOf})),
 bad:{quantity,cards,brackets:bands.map((count,index)=>({count,rate:rates[index],subtotal:count*rates[index]})),marking,markingAveragePerUnit:marking/quantity,cardTotal,setup,base,discount,discountPercentExact:percent,displayPercent:Math.round(percent*100)/100,final:750000,strict15PercentTotal:base*0.85,extraRoundingReduction:base*0.85-750000,originalArithmeticValid:true,discountArithmeticValid:true,codesOperatorFeeIncluded:false,warehouseAndBrokerIncluded:false},
 equipment:{lineAmounts:money(equipment).slice(0,-1),total:money(equipment).at(-1),arithmeticValid:true,preliminary:true,privateTrainingLine:60000,publicCoursePrice:Number(settings.trainingCoursePrice),sameTrainingProductConfirmed:false},
 limitations:['This checks the provided offers and public TANBOX rates, not legislation.','Individual discounts, hardware prices, teaching scope and deadlines are not general tariffs.','Website pricing is a timestamped snapshot, not an indefinitely valid quote.','Silence does not establish a reason for rejection.']};
const target=path.join(__dirname,'../docs/knowledge/commercial-offer-audit.json');fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({uniqueDocuments:4,badBase:base,badFinal:750000,discountPercent:percent,equipmentTotal:245000,arithmeticValid:true,publicRatesMatch:true},null,2));

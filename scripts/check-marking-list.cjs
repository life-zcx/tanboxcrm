const assert=require('node:assert/strict');
const path=require('node:path');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const {lookupMarkingList}=require('../backend/dist/knowledge/web.list');
const {prisma}=require('../backend/dist/config/db');
(async()=>{
  const shoes=await lookupMarkingList('6401');
  assert.equal(shoes.sourceRows,293);
  assert(shoes.rows.some(r=>r.number==='8'&&r.matchedCode==='6401'));
  const shared=await lookupMarkingList('2106 90 980 8');
  assert.equal(shared.rows.filter(r=>r.number==='251').length,2);
  assert(shared.rows.filter(r=>r.number==='251').every(r=>r.partialCode));
  const multi=await lookupMarkingList('3304');
  assert(multi.rows.some(r=>r.number==='31'&&r.partialCode));
  const water=await lookupMarkingList('2201');
  assert.equal(water.total,0);
  await assert.rejects(lookupMarkingList('abc'),/код ТН ВЭД/);
  console.log(JSON.stringify({sourceRows:shoes.sourceRows,hash:shoes.contentHash,shoes:shoes.rows.filter(r=>r.number==='8').length,sharedRows:shared.rows.filter(r=>r.number==='251').length,multiCodeRows:multi.rows.filter(r=>r.number==='31').length,waterRows:water.total,fresh:shoes.fresh}));
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>prisma.$disconnect());

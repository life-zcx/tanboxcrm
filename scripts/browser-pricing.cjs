const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../frontend/node_modules/playwright-core');
const {calculateQuote}=require('../backend/dist/pricing/calculation');
const {pricingSchema}=require('../backend/dist/pricing/calculation');
const raw=require('../backend/test/fixtures/pricing.json');
const pricing=pricingSchema.parse(raw),id='12345678-1234-4123-8123-123456789012',quoteId='22345678-1234-4123-8123-123456789012';
async function main(){
 const executable=path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1208/chrome-win64/chrome.exe');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync(executable)?executable:undefined)});
 const base=process.env.CRM_BROWSER_URL||'http://127.0.0.1:3050';
 let quote=null,posted=null,replyPayload=null,sourceAvailable=true;const errors=[];
 try{
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{
   const req=route.request(),url=new URL(req.url()),send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(url.pathname==='/api/auth/me')return send({user:{id,telegramChatId:'8563274673',role:'ADMIN'}});
   if(url.pathname==='/api/ai/status')return send({providers:{gemini:{state:'ready'},openai:{state:'unconfigured'}},telegramBot:{running:true}});
   if(url.pathname==='/api/ai/draft-chat')return send({entries:[]});
   if(url.pathname==='/api/clients/'+id)return send({client:{id,name:'Synthetic pricing client',status:'LEAD',estimatedVolume:80000,conversations:[],deals:[],aiSuggestions:[],createdAt:new Date().toISOString(),lastContactAt:new Date().toISOString()}});
   if(url.pathname==='/api/ai/pricing')return sourceAvailable?send({snapshot:{hash:'test-pricing',sourceUrl:'https://tanbox.kz/api/tariffs',checkedAt:new Date().toISOString(),pricing}}):send({error:'Pricing source unavailable'},503);
   if(url.pathname==='/api/ai/quotes'&&req.method()==='GET')return send({quotes:quote?[quote]:[],total:quote?1:0});
   if(url.pathname==='/api/ai/quotes'&&req.method()==='POST'){
    posted=JSON.parse(req.postData());const calculation=calculateQuote(posted.input,pricing);
    quote={id:quoteId,clientId:id,pricingHash:'test-pricing',createdAt:new Date().toISOString(),reviewAfter:new Date(Date.now()+86400000).toISOString(),total:calculation.total,calculation};return send({quote},201);
   }
   if(url.pathname==='/api/ai/quotes/'+quoteId+'/revoke'){quote.revokedAt=new Date().toISOString();return send({success:true});}
   if(url.pathname==='/api/ai/suggest-reply'){replyPayload=JSON.parse(req.postData());return send({suggestion:{reply:'Итого услуги 883 900 ₸. Коды и склад оплачиваются отдельно.',explanation:'Saved quote',evidence:[],commercialEvidence:{quoteId,calculation:quote.calculation}}});}
   return send({clients:[],deals:[],total:0});
  });
  await page.goto(base+'/clients/'+id+'?tab=pricing',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Расчёт стоимости услуг',exact:true}).waitFor();assert.equal(await page.getByLabel('Единиц в партии',{exact:true}).inputValue(),'');
  await page.getByLabel('Единиц в партии',{exact:true}).fill('20000');await page.getByLabel('Карточки товаров',{exact:true}).selectOption('FULL');await page.getByLabel('Количество карточек',{exact:true}).fill('30');await page.getByLabel('Первоначальное сопровождение',{exact:true}).check();
  await page.getByRole('button',{name:'Рассчитать и сохранить',exact:true}).click();const result=page.getByTestId('commercial-quote');await result.waitFor();
  assert.equal(posted.input.itemsCount,20000);assert.equal(posted.input.cardsCount,30);assert.equal(quote.calculation.total,883900);
  await result.getByRole('button',{name:'Скопировать расчёт',exact:true}).click();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert(copied.includes('883'));assert(copied.includes('оператору отдельно'));assert(copied.includes('склада'));
  await result.getByRole('button',{name:'Использовать в ответе',exact:true}).click();await page.getByRole('button',{name:'Сформировать ответ',exact:true}).click();await page.getByText('Итого услуги 883 900 ₸. Коды и склад оплачиваются отдельно.',{exact:true}).waitFor();assert.equal(replyPayload.quoteId,quoteId);
  await page.getByRole('button',{name:'Расчёт стоимости',exact:true}).click();await page.getByRole('button',{name:'Исключить из подсказок',exact:true}).click();await page.getByText('Исключён из подсказок',{exact:true}).waitFor();
  sourceAvailable=false;await page.reload({waitUntil:'networkidle'});await page.getByRole('alert').filter({hasText:'Pricing source unavailable'}).waitFor();await page.getByRole('heading',{name:'История расчётов: 1',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Рассчитать и сохранить'}).isDisabled());assert.deepEqual(errors,[]);
  const report={partyNotPrefilledWithAnnualVolume:true,serverRequestVerified:true,offerTotal:883900,copyPreservesExclusions:true,selectedQuoteUsedForAI:true,revocationPreservesHistory:true,historyAvailableDuringPricingOutage:true,browserErrors:errors};
  fs.writeFileSync(path.join(__dirname,'../test-results/pricing-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});

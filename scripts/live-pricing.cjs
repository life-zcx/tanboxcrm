// Creates and removes one synthetic client and its own short-lived session.
// Never writes to existing customer cards or sends customer messages.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const jwt=require('../backend/node_modules/jsonwebtoken'),{chromium}=require('../frontend/node_modules/playwright-core');
const {prisma}=require('../backend/dist/config/db'),{env}=require('../backend/dist/config/env');
const {quoteForReply}=require('../backend/dist/pricing/pricing.service');
async function main(){
 const user=await prisma.adminUser.findFirstOrThrow({where:{telegramChatId:{in:[...env.TELEGRAM_ALLOWED_USER_IDS]},role:'ADMIN'}});
 const session=await prisma.authSession.create({data:{userId:user.id,expiresAt:new Date(Date.now()+240000)}});
 let browser,client;
 try{
  client=await prisma.client.create({data:{name:'Synthetic pricing verification',estimatedVolume:80000,notes:'Temporary automatic verification fixture'}});
  const token=jwt.sign({sub:user.id,jti:session.id},env.JWT_SECRET,{issuer:'tanbox-crm',audience:'tanbox-web',expiresIn:'4m'});
  const executable=path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1208/chrome-win64/chrome.exe');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync(executable)?executable:undefined)});
  const context=await browser.newContext();await context.addCookies([{name:'tanbox_session',value:token,url:env.APP_ORIGIN,httpOnly:true,sameSite:'Strict',secure:env.COOKIE_SECURE}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(env.APP_ORIGIN+'/clients/'+client.id+'?tab=pricing',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Расчёт стоимости услуг',exact:true}).waitFor();assert.equal(await page.getByLabel('Единиц в партии',{exact:true}).inputValue(),'');
  await page.getByLabel('Единиц в партии',{exact:true}).fill('20000');await page.getByLabel('Карточки товаров',{exact:true}).selectOption('FULL');await page.getByLabel('Количество карточек',{exact:true}).fill('30');await page.getByLabel('Первоначальное сопровождение',{exact:true}).check();
  await page.getByRole('button',{name:'Рассчитать и сохранить',exact:true}).click();await page.getByTestId('commercial-quote').waitFor();
  let quotes=await prisma.commercialQuote.findMany({where:{clientId:client.id},orderBy:{createdAt:'desc'}});assert.equal(quotes.length,1);assert.equal(Number(quotes[0].total),883900);
  await page.getByLabel('Скидка по решению менеджера, ₸',{exact:true}).fill('133900');await page.getByLabel('Причина скидки',{exact:true}).fill('Synthetic explicit adjustment for verification');
  await page.getByRole('button',{name:'Рассчитать и сохранить',exact:true}).click();await page.getByTestId('commercial-quote').waitFor();
  quotes=await prisma.commercialQuote.findMany({where:{clientId:client.id},orderBy:{createdAt:'desc'}});assert.equal(quotes.length,2);assert.equal(Number(quotes[0].total),750000);const current=quotes[0];
  assert.equal((await prisma.client.findUniqueOrThrow({where:{id:client.id}})).estimatedVolume,80000);
  assert.equal((await quoteForReply(client.id,current.id)).evidence.quoteId,current.id);
  await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'История расчётов: 2',exact:true}).waitFor();
  await page.getByRole('button',{name:'Открыть расчёт',exact:true}).first().click();await page.screenshot({path:path.join(__dirname,'../test-results/pricing-live.png'),fullPage:true});
  await page.getByTestId('commercial-quote').getByRole('button',{name:'Использовать в ответе',exact:true}).click();
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/ai/suggest-reply'),{timeout:65000});await page.getByRole('button',{name:'Сформировать ответ',exact:true}).click();
  const response=await responsePromise,body=await response.json();let model={verified:false,status:response.status()};
  if(response.ok()){
   assert(body.suggestion,'Unexpected reply response: '+JSON.stringify({status:response.status(),body}));
   assert.equal(body.suggestion.commercialEvidence.quoteId,current.id);assert(/750[ \u00a0\u202f]?000/.test(body.suggestion.reply));
   assert(/код|оператор/i.test(body.suggestion.reply));
   model={verified:true,status:response.status(),reply:body.suggestion.reply};
  }else{if(![429,503].includes(response.status()))throw Error('Reply check failed: '+JSON.stringify(body));}
  const revoked=await context.request.post(env.APP_ORIGIN+'/api/ai/quotes/'+current.id+'/revoke',{data:{},headers:{Origin:env.APP_ORIGIN}});assert.equal(revoked.status(),200);assert.equal((await quoteForReply(client.id)).evidence,null);
  assert.deepEqual(errors,[]);
  const report={baseTotal:883900,discountedTotal:750000,versionsPreserved:2,annualVolumeNotUsed:true,quoteSurvivesReload:true,revokedLatestDoesNotReviveOldQuote:true,model,browserErrors:errors,checkedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(__dirname,'../test-results/pricing-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{if(browser)await browser.close();if(client)await prisma.client.deleteMany({where:{id:client.id}});await prisma.authSession.deleteMany({where:{id:session.id}});}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

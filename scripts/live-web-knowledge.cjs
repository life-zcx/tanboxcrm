const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const jwt=require('../backend/node_modules/jsonwebtoken');
const {prisma}=require('../backend/dist/config/db'),{env}=require('../backend/dist/config/env');
const {chromium}=require('../frontend/node_modules/playwright-core');
async function main(){
 const user=await prisma.adminUser.findFirstOrThrow({where:{telegramChatId:{in:[...env.TELEGRAM_ALLOWED_USER_IDS]},role:'ADMIN'}});
 const session=await prisma.authSession.create({data:{userId:user.id,expiresAt:new Date(Date.now()+180000)}});
 const token=jwt.sign({sub:user.id,jti:session.id},env.JWT_SECRET,{issuer:'tanbox-crm',audience:'tanbox-web',expiresIn:'3m'});let browser;
 try{
  const executable=path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1208/chrome-win64/chrome.exe');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync(executable)?executable:undefined)});
  const context=await browser.newContext();await context.addCookies([{name:'tanbox_session',value:token,url:env.APP_ORIGIN,httpOnly:true,sameSite:'Strict',secure:env.COOKIE_SECURE}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.goto(env.APP_ORIGIN+'/knowledge/web',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Маркировка в Казахстане: источники и проверка'}).waitFor();
  const response=await context.request.get(env.APP_ORIGIN+'/api/settings/knowledge/web');assert.equal(response.status(),200);const overview=await response.json();assert(overview.stats.sources>=179);assert(overview.stats.collected>=100);assert(overview.stats.publishedFacts>=24);
  assert.equal(overview.coreStats.sources+overview.supportingStats.sources,overview.stats.sources);
  assert.equal(overview.coreStats.attention+overview.supportingStats.attention,overview.stats.attention);
  assert.equal(overview.sources.filter(s=>s.sharedDocument).length,overview.sharedDocumentCount);
  await page.getByRole('heading',{name:'Реестр: '+overview.coreStats.sources+' источников'}).waitFor();
  await page.getByText('Страница 1 из '+Math.ceil(overview.coreStats.sources/40),{exact:true}).waitFor();
  await page.getByRole('button',{name:'Следующая страница'}).click();
  await page.getByText('Страница 2 из '+Math.ceil(overview.coreStats.sources/40),{exact:true}).waitFor();
  await page.getByLabel('Показать справочные материалы ЕАЭС').check();
  await page.getByRole('heading',{name:'Реестр: '+overview.stats.sources+' источников'}).waitFor();
  await page.getByText('Страница 1 из '+Math.ceil(overview.stats.sources/40),{exact:true}).waitFor();
  await page.getByLabel('Показать справочные материалы ЕАЭС').uncheck();
  await page.getByLabel('Категория интернет-базы',{exact:true}).selectOption('shoes');await page.reload({waitUntil:'networkidle'});assert.equal(new URL(page.url()).searchParams.get('category'),'shoes');
  const searchPromise=page.waitForResponse(r=>r.url().includes('/knowledge/web/search?'));
  await page.getByLabel('Поиск в официальных материалах',{exact:true}).fill('маркировка обуви');await page.getByRole('button',{name:'Найти',exact:true}).click();
  const found=await (await searchPromise).json();assert(found.passages.length>0);
  assert(found.passages.every(p=>typeof p.quality==='string'));
  assert(found.passages.every(p=>!p.url.startsWith('https://docs.eaeunion.org/upload/')));
  const ocrSearchPromise=page.waitForResponse(r=>r.url().includes('/knowledge/web/search?'));
  await page.getByLabel('Поиск в официальных материалах',{exact:true}).fill('Приложение');await page.getByRole('button',{name:'Найти',exact:true}).click();
  const ocrResults=await (await ocrSearchPromise).json();
  if(ocrResults.passages.some(p=>p.quality==='OCR_UNREVIEWED'))await page.getByText('OCR: распознанный текст не сверен с оригинальным PDF. Не используйте даты и номера без проверки.',{exact:true}).first().waitFor();
  const listPromise=page.waitForResponse(r=>r.url().includes('/knowledge/web/list-lookup?'));
  await page.getByLabel('Код ТН ВЭД для поиска в перечне').fill('2106 90 980 8');
  await page.getByRole('button',{name:'Найти строку'}).click();
  const listResponse=await listPromise;assert.equal(listResponse.status(),200);
  const list=await listResponse.json();assert.equal(list.sourceRows,293);assert.equal(list.rows.filter(r=>r.number==='251').length,2);
  await page.getByText('Позиция 251 · из 2106 90 980 8').first().waitFor();
  const absentPromise=page.waitForResponse(r=>r.url().includes('/knowledge/web/list-lookup?'));
  await page.getByLabel('Код ТН ВЭД для поиска в перечне').fill('2201');
  await page.getByRole('button',{name:'Найти строку'}).click();
  assert.equal((await (await absentPromise).json()).total,0);
  await page.getByText('В сохранённой редакции строка с этим кодом не найдена.',{exact:false}).waitFor();
  const source=await prisma.webKnowledgeSource.findUniqueOrThrow({where:{url:'https://zan.gov.kz/api/documents/225827/rus/download/pdf'}});
  const revision=await prisma.webKnowledgeRevision.findUniqueOrThrow({where:{id:source.currentRevisionId}});
  await page.goto(env.APP_ORIGIN+'/knowledge/web/documents/'+revision.id,{waitUntil:'networkidle'});
  assert.equal(await page.getByTestId('web-knowledge-text').textContent(),revision.text);
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByTestId('web-knowledge-text').textContent(),revision.text);
  const raw=await context.request.get(env.APP_ORIGIN+'/api/settings/knowledge/web/documents/'+revision.id+'/raw');assert.equal(raw.status(),200);assert.deepEqual(await raw.body(),revision.data);
  const disputed=await prisma.webKnowledgeSource.findUniqueOrThrow({where:{url:'https://tanba.telecom.kz/ru/business/product/supplements'}});
  if(disputed.status==='NEEDS_REVIEW'){
    await page.goto(env.APP_ORIGIN+'/knowledge/web/documents/'+disputed.currentRevisionId,{waitUntil:'networkidle'});
    await page.getByText('Нужна проверка',{exact:true}).waitFor();
    await page.getByText(disputed.lastError,{exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);
  const report={...overview.stats,core:overview.coreStats,supporting:overview.supportingStats,sharedDocumentCount:overview.sharedDocumentCount,categories:overview.categories.length,monitoring:overview.monitoring,searchPassages:found.passages.length,officialListRows:list.sourceRows,mergedListRows:list.rows.filter(r=>r.number==='251').length,fullOfficialTextCharacters:revision.text.length,originalBytesEqual:true,directUrlsAndReload:true,browserErrors:errors};
  fs.writeFileSync(path.join(__dirname,'../test-results/web-knowledge-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{if(browser)await browser.close();await prisma.authSession.deleteMany({where:{id:session.id}});}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

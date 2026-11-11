const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
require('../backend/node_modules/dotenv').config({path:path.join(__dirname,'../backend/.env'),override:true});
const jwt=require('../backend/node_modules/jsonwebtoken');
const {prisma}=require('../backend/dist/config/db');
const {env}=require('../backend/dist/config/env');
const {activeArchive,validateBundle}=require('../backend/dist/knowledge/archive.service');
const {chromium}=require('../frontend/node_modules/playwright-core');
async function main(){
  const batch=await activeArchive();assert(batch,'Import the knowledge archive first');
  const user=await prisma.adminUser.findFirstOrThrow({where:{telegramChatId:{in:[...env.TELEGRAM_ALLOWED_USER_IDS]},role:'ADMIN'}});
  const session=await prisma.authSession.create({data:{userId:user.id,expiresAt:new Date(Date.now()+180000)}});
  const token=jwt.sign({sub:user.id,jti:session.id},env.JWT_SECRET,{algorithm:'HS256',expiresIn:'3m',issuer:'tanbox-crm',audience:'tanbox-web'});
  let browser;
  try{
    const executable=path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1208/chrome-win64/chrome.exe');
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync(executable)?executable:undefined)});
    const context=await browser.newContext({acceptDownloads:true});
    await context.addCookies([{name:'tanbox_session',value:token,url:env.APP_ORIGIN,httpOnly:true,sameSite:'Strict',secure:env.COOKIE_SECURE}]);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
    await page.goto(env.APP_ORIGIN+'/knowledge',{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Полная база знаний TANBOX',exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Категории базы знаний'}).getByRole('button').count(),14);
    await page.getByRole('button',{name:'Проверить полноту хранения',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Все контрольные суммы совпали.'}).waitFor();
    const allLanguages=page.waitForResponse(r=>r.url().includes('/knowledge/library?')&&new URL(r.url()).searchParams.get('language')==='ALL');
    await page.getByLabel('Язык материала',{exact:true}).selectOption('ALL');
    assert.equal((await (await allLanguages).json()).total,batch.manifest.coverage.documents);
    await page.getByText('Найдено: '+batch.manifest.coverage.documents+'.',{exact:false}).waitFor();
    const russian=page.waitForResponse(r=>r.url().includes('/knowledge/library?')&&new URL(r.url()).searchParams.get('language')==='ru');
    await page.getByLabel('Язык материала',{exact:true}).selectOption('ru');await russian;await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'Обувные товары',exact:true}).click();
    await page.waitForLoadState('networkidle');assert.equal(new URL(page.url()).searchParams.get('category'),'shoes');
    await page.reload({waitUntil:'networkidle'});assert.equal(new URL(page.url()).searchParams.get('category'),'shoes');
    await page.getByRole('button',{name:'Все категории',exact:true}).click();
    await page.getByLabel('Тип материала',{exact:true}).selectOption('TECHNICAL');await page.waitForLoadState('networkidle');
    const doc=await prisma.knowledgeDocument.findFirstOrThrow({where:{importId:batch.id,kind:'TECHNICAL'},orderBy:{title:'asc'}});
    await page.getByRole('link').filter({hasText:doc.title}).click();await page.waitForLoadState('networkidle');
    assert.equal(await page.getByTestId('knowledge-full-text').textContent(),doc.content);
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByTestId('knowledge-full-text').textContent(),doc.content);
    const source=await prisma.knowledgeSource.findFirstOrThrow({where:{importId:batch.id,path:{in:doc.sourcePaths}}});
    const sourceResponse=await context.request.get(env.APP_ORIGIN+'/api/settings/knowledge/library/sources/'+source.id);
    assert.equal(sourceResponse.status(),200);assert.deepEqual(await sourceResponse.body(),source.data);
    await page.getByRole('link',{name:'← К материалам базы знаний'}).click();await page.waitForLoadState('networkidle');
    const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Полный экспорт',exact:true}).click();
    const download=await downloadPromise;assert.equal(await download.failure(),null);
    const exported=validateBundle(JSON.parse(fs.readFileSync(await download.path(),'utf8')));assert.equal(exported.bundleHash,batch.bundleHash);
    assert.deepEqual(errors,[]);
    const result={categories:exported.manifest.coverage.categories,documents:exported.documents.length,sources:exported.sources.length,
      fullDocumentCharacters:doc.content.length,sourceBytesEqual:true,exportChecksumsValid:true,categoryReloadAndDirectDocumentUrl:true,browserErrors:errors};
    fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/knowledge-live.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }finally{if(browser)await browser.close();await prisma.authSession.deleteMany({where:{id:session.id}});}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());

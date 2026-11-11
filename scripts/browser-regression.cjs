const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('../frontend/node_modules/playwright-core');
async function main(){
  const defaultPath=path.join(process.env.LOCALAPPDATA||'', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
  const executablePath=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync(defaultPath)?defaultPath:undefined);
  const browser=await chromium.launch({headless:true,executablePath});
  const base=process.env.CRM_BROWSER_URL||'http://127.0.0.1:3050/';
  const tests=[];
  const user={id:'12345678-1234-4123-8123-123456789012',telegramChatId:'8563274673',telegramUsername:'test',role:'ADMIN'};
  try{
    const context=await browser.newContext();
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Login required'})}));
    const started=Date.now();
    await page.goto(base,{waitUntil:'networkidle',timeout:15000});
    await page.getByRole('heading',{name:'Вход в систему управления'}).waitFor();
    assert.equal(errors.length,0);
    tests.push({name:'fresh page renders without JavaScript errors',ms:Date.now()-started});
    const sent=[];
    await page.unroute('**/api/**');
    await page.route('**/api/**',route=>{
      const url=route.request().url();
      if(url.endsWith('/auth/request-code'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({botUrl:'https://t.me/test_bot?start=login_test',expiresIn:300})});
      if(url.endsWith('/auth/verify-code')){sent.push(route.request().postDataJSON().code);return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Test invalid code'})});}
      return route.fulfill({status:401,contentType:'application/json',body:'{}'});
    });
    await page.getByRole('button',{name:'Получить код в Telegram',exact:true}).click();
    await page.getByLabel('Код из Telegram',{exact:true}).pressSequentially('123456',{delay:20});
    await page.getByRole('alert').waitFor();
    assert.deepEqual(sent,['123456']);
    await page.getByLabel('Код из Telegram',{exact:true}).fill('654321');
    await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent==='Test invalid code');
    assert.deepEqual(sent,['123456','654321']);
    tests.push({name:'typed and pasted OTP use the complete current value exactly once'});
    await context.close();

    const temporary=await browser.newContext(),p2=await temporary.newPage();
    let available=false,meCount=0;
    await p2.route('**/api/**',route=>{
      const url=route.request().url();
      if(url.endsWith('/auth/me')){meCount++;return route.fulfill({status:available?200:503,contentType:'application/json',body:JSON.stringify(available?{user}:{error:'Temporary outage'})});}
      if(url.includes('/deals?'))return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Database unavailable'})});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({providers:{gemini:{state:'ready'},openai:{state:'unconfigured'}},telegramBot:{running:false}})});
    });
    await p2.goto(base,{waitUntil:'networkidle'});
    await p2.getByRole('button',{name:'Повторить подключение'}).waitFor();
    assert(!(await p2.getByRole('heading',{name:'Вход в систему управления'}).count()));
    available=true;
    await p2.getByRole('button',{name:'Повторить подключение'}).click();
    await p2.getByRole('alert').filter({hasText:'Database unavailable'}).waitFor();
    await p2.getByRole('button',{name:'Повторить загрузку'}).waitFor();
    assert(meCount>=2);
    tests.push({name:'temporary session outage has retry; failed data loads show explicit error'});
    await temporary.close();

    const response=await fetch(new URL('/assets/nonexistent-regression.js',base));
    assert.equal(response.status,404);
    assert(!response.headers.get('content-type')?.includes('javascript'));
    const html=await fetch(base);
    assert((html.headers.get('cache-control')||'').includes('no-store'));
    assert(html.headers.get('content-security-policy'));
    tests.push({name:'missing assets return 404; HTML is not cached and has CSP'});
    fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'../test-results/browser.json'),JSON.stringify(tests,null,2));
    console.log(JSON.stringify(tests,null,2));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

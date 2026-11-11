const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('../frontend/node_modules/playwright-core');
const id='12345678-1234-4123-8123-123456789012';
const user={id,telegramChatId:'8563274673',telegramUsername:'test',role:'ADMIN'};
const client={id,name:'Deletion fixture',status:'LEAD',stage:'NEW',createdAt:'2026-11-10T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z',lastContactAt:'2026-11-10T00:00:00Z',conversations:[],deals:[],aiSuggestions:[],_count:{conversations:0,deals:0,aiSuggestions:0}};
const sample=(id,position,sender,content,time)=>({id,position,sender,content,originalTime:time,createdAt:'2026-11-10T00:00:00Z'});
client.conversations=[
  {id:'old-batch',clientId:id,channel:'WHATSAPP',source:'TELEGRAM_BOT',createdAt:'2026-11-10T09:00:00Z',messages:[sample('a1',0,'CLIENT','Здравствуйте!','17:21'),sample('a2',1,'CLIENT','Нужна маркировка одежды','17:22')]},
  {id:'new-batch',clientId:id,channel:'WHATSAPP',source:'TELEGRAM_BOT',createdAt:'2026-11-10T10:00:00Z',messages:[sample('b1',0,'CLIENT','Здравствуйте!','17:21'),sample('b2',1,'CLIENT','Нужна маркировка одежды','17:22'),sample('b3',2,'MANAGER','Уточните объём партии','17:25')]},
];client._count.conversations=2;
async function main(){
  const defaultPath=path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1208/chrome-win64/chrome.exe');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||(fs.existsSync(defaultPath)?defaultPath:undefined)});
  const base=process.env.CRM_BROWSER_URL||'http://127.0.0.1:3050/';
  const tests=[];
  try{
    const context=await browser.newContext(),page=await context.newPage();
    let deletions=0,upload='',commit='';const suggestions=[],manualPayloads=[],revisions=[];
    const draftChat={REPLY:[],COMMERCIAL_OFFER:[]};
    await page.route('**/api/**',route=>{
      const req=route.request(),url=new URL(req.url());
      const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(url.pathname==='/api/auth/me')return send({user});
      if(url.pathname==='/api/ai/status')return send({providers:{gemini:{state:'ready'},openai:{state:'unconfigured'}},telegramBot:{running:true}});
      if(url.pathname==='/api/ai/draft-chat'&&req.method()==='GET')return send({entries:draftChat[url.searchParams.get('intent')]||[]});
      if(url.pathname==='/api/ai/suggest-reply'){
        const payload=JSON.parse(req.postData());suggestions.push(payload);
        const intent=payload.intent||'REPLY',reply='Synthetic draft '+suggestions.length,suggestionId='suggestion-'+suggestions.length;
        draftChat[intent].push({id:suggestionId,query:payload.userPrompt||null,suggestedText:reply,explanation:'Test scenario',provider:'GEMINI',promptType:intent==='COMMERCIAL_OFFER'?'COMMERCIAL_OFFER':'REPLY_SUGGESTION',createdAt:new Date().toISOString()});
        return send({suggestion:{suggestionId,reply,explanation:'Test scenario',evidence:[],variations:['Alternative '+suggestions.length],intent,pricedOffer:false,context:{messageCount:4}}});
      }
      if(url.pathname==='/api/ai/draft-chat/revise'){
        const payload=JSON.parse(req.postData());revisions.push(payload);
        const intent=draftChat.COMMERCIAL_OFFER.some(entry=>entry.id===payload.suggestionId)?'COMMERCIAL_OFFER':'REPLY';
        const reply='Revised synthetic draft '+revisions.length,suggestionId='revision-'+revisions.length;
        draftChat[intent].push({id:suggestionId,query:payload.instruction,suggestedText:reply,explanation:'Correction applied',provider:'GEMINI',promptType:intent==='COMMERCIAL_OFFER'?'COMMERCIAL_OFFER':'REPLY_SUGGESTION',createdAt:new Date().toISOString()});
        return send({suggestion:{suggestionId,reply,explanation:'Correction applied',evidence:[],variations:[],intent,pricedOffer:false,context:{messageCount:4}}});
      }
      if(req.method()==='DELETE'){deletions++;return deletions===1?send({error:'Deletion temporarily unavailable'},503):send({success:true,cleanupPending:0});}
      if(url.pathname==='/api/messages/preview-screenshot'){
        upload=req.postDataBuffer().toString('latin1');
        return send({duplicate:false,reviewToken:'review-token',parsed:{clientName:'Preview client',category:'OTHER',sentiment:'NEUTRAL',summary:'Test summary',nextStep:'Call back',messages:[{sender:'MANAGER',content:'Добрый день',time:'09:38'}]}});
      }
      if(url.pathname==='/api/messages/commit-screenshot'){commit=req.postDataBuffer().toString('latin1');return send({result:{client}},201);}
      if(url.pathname==='/api/messages/client/'+id+'/manual'){
        const payload=JSON.parse(req.postData());manualPayloads.push(payload);
        const chunk={id:'87654321-4321-4321-8321-210987654321',clientId:id,channel:payload.channel,source:'MANUAL_ENTRY',summary:payload.note||'Сообщения добавлены вручную',createdAt:new Date().toISOString(),messages:payload.messages.map((message,index)=>({id:'message-'+index,position:index,createdAt:new Date().toISOString(),...message})),_count:{messages:payload.messages.length}};
        client.conversations=[chunk,...client.conversations];client._count.conversations=client.conversations.length;
        return send({chunk,duplicate:false},201);
      }
      if(url.pathname==='/api/clients/'+id)return send({client});
      if(url.pathname==='/api/clients')return send({clients:[],total:0});
      return send({deals:[],total:0,amountTotal:0});
    });
    await page.goto(new URL('/clients/'+id,base).href,{waitUntil:'networkidle'});
    for(const [index,label] of ['Повторный контакт','Подготовить расчёт','Обсудить стоимость','Оборудование и обучение'].entries()){
      await page.getByRole('button',{name:new RegExp(label)}).click();
      await page.getByText('Synthetic draft '+(index+1),{exact:true}).first().waitFor();
      const prompt=await page.getByPlaceholder('Например: Уточни состав партии или подготовь короткое сообщение после КП…').inputValue();
      assert.equal(suggestions[index].userPrompt,prompt);
      assert(!/283-1|при оплате сегодня|скидку 5/.test(prompt));
    }
    assert(suggestions[0].userPrompt.includes('повторный контакт'));
    assert(suggestions[1].userPrompt.includes('не называй цену'));
    assert(suggestions[3].userPrompt.includes('самостоятельной маркировки'));
    tests.push({name:'sales actions submit the visible prompt without automatic discounts or legal threats'});
    await page.getByRole('button',{name:'Переписка',exact:true}).click();
    assert.equal(await page.getByLabel('Последовательность переписки').getByText('Здравствуйте!',{exact:true}).count(),1);
    await page.getByText('+ Добавить сообщения вручную',{exact:true}).click();
    await page.getByLabel('Текст сообщения 1').fill('Нужна маркировка');
    await page.getByRole('button',{name:'Добавить сообщение'}).click();
    await page.getByLabel('Автор сообщения 2').selectOption('MANAGER');
    await page.getByLabel('Текст сообщения 2').fill('Уточните количество');
    await page.getByRole('button',{name:/Сохранить 2 сообщ/}).click();
    await page.getByRole('status').filter({hasText:'Сообщения добавлены'}).waitFor();
    assert.deepEqual(manualPayloads[0].messages.map(message=>message.sender),['CLIENT','MANAGER']);
    assert.deepEqual(manualPayloads[0].messages.map(message=>message.content),['Нужна маркировка','Уточните количество']);
    assert.equal(await page.getByLabel('Последовательность переписки').getByText('Нужна маркировка одежды',{exact:true}).count(),1);
    tests.push({name:'manual client messages save exact text and authors in the timeline'});
    await page.getByRole('button',{name:'Подсказка ответа',exact:true}).click();
    await page.getByRole('button',{name:'Ответить на последнее сообщение'}).click();
    assert.equal(suggestions.at(-1).userPrompt,undefined);
    await page.getByText('Alternative '+suggestions.length,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Составить КП'}).click();
    assert.equal(suggestions.at(-1).intent,'COMMERCIAL_OFFER');
    await page.getByText('Итоговая сумма не рассчитана:',{exact:false}).waitFor();
    tests.push({name:'copilot uses the latest client message, offers variants and drafts a price-free proposal'});
    const draftPanel=page.getByLabel('Чат с ИИ для правки черновика');
    await draftPanel.locator('textarea').fill('Сократи КП и убери лишние вопросы.');
    await draftPanel.getByRole('button',{name:'Исправить черновик'}).click();
    await page.getByText('Revised synthetic draft 1',{exact:true}).first().waitFor();
    assert.equal(revisions[0].instruction,'Сократи КП и убери лишние вопросы.');
    await draftPanel.getByText('Сократи КП и убери лишние вопросы.',{exact:false}).first().waitFor({state:'attached'});
    await page.reload({waitUntil:'networkidle'});
    await page.getByLabel('Чат с ИИ для правки черновика').getByText('Сократи КП и убери лишние вопросы.',{exact:false}).first().waitFor({state:'attached'});
    await page.getByText('Revised synthetic draft 1',{exact:true}).first().waitFor();
    tests.push({name:'draft chat sends a correction and keeps the revised version in history'});
    await page.getByRole('button',{name:'Удалить клиента',exact:true}).click();
    const dialog=page.getByRole('alertdialog');
    await dialog.waitFor();assert.equal(deletions,0);
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(deletions,0);
    await page.getByRole('button',{name:'Удалить клиента',exact:true}).click();
    await dialog.getByRole('button',{name:'Удалить полностью',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'Deletion temporarily unavailable'}).waitFor();
    assert.equal(deletions,1);assert(new URL(page.url()).pathname.endsWith(id));
    await dialog.getByRole('button',{name:'Удалить полностью',exact:true}).click();
    await page.waitForURL('**/clients');
    await page.getByRole('status').filter({hasText:'скриншоты удалены'}).waitFor();
    assert.equal(deletions,2);
    tests.push({name:'deletion requires confirmation, preserves the card on failure and returns to clients on success'});

    await page.goto(new URL('/ingest',base).href,{waitUntil:'networkidle'});
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG7sAAAAASUVORK5CYII=','base64');
    await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles([{name:'later.png',mimeType:'image/png',buffer:png},{name:'earlier.png',mimeType:'image/png',buffer:png}]);
    await page.getByRole('button',{name:'Переместить скриншот 2 раньше',exact:true}).click();
    assert.deepEqual(await page.locator('p[title]').allTextContents(),['earlier.png','later.png']);
    await page.getByRole('button',{name:/Распознать и проверить/}).click();
    await page.getByLabel('Проверка распознанной переписки').waitFor();
    await page.getByLabel('Автор сообщения 1').selectOption('CLIENT');
    await page.getByRole('button',{name:'Подтвердить и сохранить переписку'}).click();
    await page.waitForURL('**/clients/'+id);
    assert(upload.indexOf('filename="earlier.png"')>=0);
    assert(upload.indexOf('filename="earlier.png"')<upload.indexOf('filename="later.png"'));
    assert(commit.includes('CLIENT'));
    tests.push({name:'screenshot order and corrected sender are confirmed before CRM save'});
    await context.close();
    fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'../test-results/client-tools.json'),JSON.stringify(tests,null,2));
    console.log(JSON.stringify(tests,null,2));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

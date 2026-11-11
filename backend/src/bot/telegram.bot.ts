import {randomUUID} from 'node:crypto';
import {Telegraf,Markup,Context} from 'telegraf';
import type {InlineKeyboardButton} from 'telegraf/types';
import {z} from 'zod';
import {env,isAllowedTelegramUser} from '../config/env';
import {prisma} from '../config/db';
import {issueCode} from '../modules/auth/auth.service';
import {aiOrchestrator} from '../ai/ai.orchestrator';
import {parsedConversationSchema} from '../ai/gemini.service';
import {createTelegramScreenshotDraft,getTelegramScreenshotDraft,updateTelegramScreenshotDraft,commitTelegramScreenshotDraft,discardScreenshotDraft} from './screenshot-drafts.service';
import {TANBOX_KNOWLEDGE} from '../ai/knowledge.service';
import {AppError} from '../lib/errors';
import {prepareImages,deleteImages,MAX_FILES,MAX_FILE_BYTES,MAX_TOTAL_BYTES} from '../lib/files';
import {idSchema,clientStatuses,statusToStage} from '../lib/validation';
import {deleteClientCompletely} from '../modules/clients/client-deletion.service';
import {activeArchive,archiveDocument,splitPassages} from '../knowledge/archive.service';
import {webOverview,usableFacts} from '../knowledge/web.service';
import {quoteForReply,quoteText} from '../pricing/pricing.service';
export const BOT_LABELS={upload:'📸 Загрузить переписку',clients:'👥 Клиенты',reply:'💡 Что ответить',pipeline:'📊 Воронка',knowledge:'📚 База знаний',login:'🔐 Вход в веб',help:'❓ Помощь'} as const;
const labels:Record<string,string>={LEAD:'Новый лид',IN_NEGOTIATION:'В переговорах',KP_SENT:'КП отправлено',PAYMENT_PENDING:'Ожидает оплаты',IN_PROGRESS:'В работе',WON:'Оплачено',LOST:'Отказ'};
const stageLabels:Record<string,string>={NEW:'Новые лиды',QUALIFIED:'В переговорах',OFFER_SENT:'КП отправлено',INVOICED:'Ожидают оплаты',PAID:'Оплачено',CLOSED_LOST:'Отказы'};
type QueuedFile={id:string;mime:string;messageId?:number};
type Batch={ctx:Context;files:QueuedFile[];timer:NodeJS.Timeout;targetClientId?:string};
type UserState={updated:number;mode?:'import'|'search'|'question';targetClientId?:string;activeClientId?:string;pendingText?:string;retryText?:{text:string;targetClientId?:string};retryImages?:{files:QueuedFile[];targetClientId?:string};reviewEdit?:{draftId:string;index?:number;field:'content'|'summary'|'nextStep'};listAction?:'dossier'|'reply'|'attach';search?:string;busy?:boolean};
export class TelegramBotService {
  private bot:Telegraf|null=env.TELEGRAM_BOT_TOKEN?new Telegraf(env.TELEGRAM_BOT_TOKEN,{handlerTimeout:90000}):null;
  private owner=randomUUID();
  private leaseKey='telegram-polling-lease';
  private running=false;
  private starting=false;
  private stopping=false;
  private state='stopped';
  private retryTimer?:NodeJS.Timeout;
  private leaseTimer?:NodeJS.Timeout;
  private batches=new Map<string,Batch>();
  private userRequests=new Map<string,number>();
  private users=new Map<string,UserState>();
  constructor(){
    if(this.bot){
      const telegram=this.bot.telegram as any,call=telegram.callApi.bind(telegram);
      telegram.callApi=async(method:string,...args:any[])=>{
        if(method==='getUpdates'&&!this.stopping){this.running=true;this.state='running';}
        try{return await call(method,...args);}catch(error){if(method==='getUpdates'){this.running=false;this.state='reconnecting';}throw error;}
      };
      this.registerHandlers();
    }
  }
  isAvailable(){return this.running;}
  getStatus(){return {configured:!!this.bot,running:this.running,state:this.state,name:env.TELEGRAM_BOT_USERNAME};}
  private safeError(error:any){
    return String(error?.response?.description||error?.message||error?.name||'network')
      .split(env.TELEGRAM_BOT_TOKEN||'__no_token__').join('[redacted]').replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,240);
  }
  private session(ctx:Context){
    const key=String(ctx.from!.id),old=this.users.get(key);
    if(old&&(old.busy||Date.now()-old.updated<30*60_000)){old.updated=Date.now();return old;}
    const value:UserState={updated:Date.now()};this.users.set(key,value);return value;
  }
  private keyboard(){return Markup.keyboard([[BOT_LABELS.upload,BOT_LABELS.clients],[BOT_LABELS.reply,BOT_LABELS.pipeline],[BOT_LABELS.knowledge,BOT_LABELS.login],[BOT_LABELS.help]]).resize().persistent();}
  private async reply(ctx:Context,text:string,extra:Record<string,unknown>={}){
    const pieces=text.match(/[\s\S]{1,3500}/g)||[''];
    for(let i=0;i<pieces.length;i++)await ctx.reply(pieces[i],i===pieces.length-1?{...this.keyboard(),...extra}:{});
  }
  private userError(error:unknown){return error instanceof AppError?error.message:'Не удалось выполнить действие. Попробуйте ещё раз.';}
  private webLink(path:string){
    const host=new URL(env.APP_ORIGIN).hostname;
    if(host==='localhost'||host==='127.0.0.1'||host==='[::1]')return null;
    return Markup.button.url('🌐 Открыть в CRM',env.APP_ORIGIN+path);
  }
  private async home(ctx:Context){
    const s=this.session(ctx);s.mode=undefined;s.pendingText=undefined;s.targetClientId=undefined;
    await this.reply(ctx,'TANBOX CRM — клиенты и переговоры\n\n📸 Отправьте скриншоты WhatsApp: сначала покажу распознанный черновик, затем вы подтвердите сохранение. Текст переписки тоже можно отправить в бот.\n💡 Помогу подготовить ответ с учётом истории и тарифов.\n👥 В карточке клиента доступны досье, статусы и добавление переписки.\n\nВыберите действие в меню ниже. Вход по коду нужен только для веб-панели.');
  }
  private async help(ctx:Context){
    await this.reply(ctx,'Как работать с CRM\n\n1. Нажмите «Загрузить переписку». Отправьте текст или 1–15 скриншотов одной беседы.\n2. Для скриншотов проверьте черновик: автора, текст и порядок сообщений. Исправьте ошибки и нажмите «Сохранить». Черновик доступен через /review 30 минут.\n3. После сохранения откроется карточка: «Что ответить», «Добавить переписку», «Изменить статус».\n4. В «Клиенты» есть поиск, страницы и история.\n\nФайлы: PNG/JPG/WEBP, до 10 МБ каждый, до 40 МБ суммарно. Каждая пачка — один диалог.\n\nВеб-панель: '+env.APP_ORIGIN+'\nДля входа нажмите кнопку Telegram на странице входа. /cancel — отменить выбор действия.');
  }
  private async login(ctx:Context){await this.reply(ctx,'Вход в веб-панель\n\nОткройте '+env.APP_ORIGIN+' на компьютере, нажмите «Получить код в Telegram», затем откройте бота по появившейся ссылке.\n\nКод будет действовать только для этого запроса. Все функции CRM в боте доступны через меню ниже.');}
  private async importHelp(ctx:Context,targetClientId?:string){
    const s=this.session(ctx);s.mode='import';s.targetClientId=targetClientId;s.pendingText=undefined;
    const client=targetClientId?await prisma.client.findUnique({where:{id:targetClientId}}):null;
    await this.reply(ctx,'Добавление переписки\n\nОтправьте скриншоты одной беседы по порядку от старых сообщений к новым или вставьте текст. Каждый скриншот читается сверху вниз. После паузы 2,5 секунды начну распознавание пачки.\n\nПривязка: '+(client?client.name:'автоматически по телефону / БИН; иначе новый клиент')+'.',
      {...Markup.inlineKeyboard([[Markup.button.callback('👤 Выбрать клиента','attach'),Markup.button.callback('Автоопределение','import:auto')],[Markup.button.callback('Отмена','cancel')]])});
  }
  private async clients(ctx:Context,offset=0,action?:UserState['listAction']){
    const s=this.session(ctx);if(action)s.listAction=action;
    const search=(s.search||'').slice(0,200),digits=search.replace(/\D/g,'');
    const where=search?{OR:[{name:{contains:search,mode:'insensitive' as const}},{company:{contains:search,mode:'insensitive' as const}},{phone:{contains:digits||search}},{binIin:{contains:search}}]}:{};
    const [clients,total]=await prisma.$transaction([prisma.client.findMany({where,skip:offset,take:8,orderBy:[{lastContactAt:'desc'},{id:'asc'}]}),prisma.client.count({where})]);
    const rows=clients.map(c=>[Markup.button.callback((s.listAction==='reply'?'💡 ':'👤 ')+c.name.slice(0,32),(s.listAction==='reply'?'pickreply:':s.listAction==='attach'?'pickattach:':'dossier:')+c.id)]);
    const nav=[];if(offset>0)nav.push(Markup.button.callback('← Назад','clients:'+Math.max(0,offset-8)));if(offset+8<total)nav.push(Markup.button.callback('Далее →','clients:'+(offset+8)));if(nav.length)rows.push(nav);
    rows.push([Markup.button.callback('🔎 Поиск','search'),Markup.button.callback('Сбросить поиск','search:clear')],[Markup.button.callback('Главное меню','home')]);
    const summary=clients.map((c,i)=>(offset+i+1)+'. '+c.name+' — '+(labels[c.status]||c.status)+(c.phone?'\n'+c.phone:'')).join('\n\n');
    await this.reply(ctx,(s.listAction==='attach'?'Выберите клиента для переписки':s.listAction==='reply'?'Для кого подготовить ответ?':'Клиенты')+(search?'\nПоиск: '+search:'')+'\n'+(total?String(offset+1)+'–'+Math.min(offset+8,total)+' из '+total:'Ничего не найдено')+'\n\n'+summary,{...Markup.inlineKeyboard(rows)});
  }
  private async card(ctx:Context,id:string){
    const client=await prisma.client.findUnique({where:{id},include:{_count:{select:{conversations:true,deals:true}}}});
    if(!client)throw new AppError(404,'Клиент не найден');
    this.session(ctx).activeClientId=id;
    const rows:InlineKeyboardButton[][]=[
      [Markup.button.callback('💡 Что ответить','pickreply:'+id)],
      [Markup.button.callback('📎 Добавить переписку','pickattach:'+id),Markup.button.callback('📊 Изменить статус','status:'+id)],
      [Markup.button.callback('🕘 Последняя переписка','history:'+id)],
      [Markup.button.callback('🗑 Удалить клиента / лид','deleteconfirm:'+id)],
    ];
    if(client.phone&&/^\d{10,15}$/.test(client.phone))rows.push([Markup.button.url('Написать в WhatsApp','https://wa.me/'+client.phone)]);
      rows.push([Markup.button.callback('💰 Расчёт стоимости','price:'+id)]);
      const web=this.webLink('/clients/'+id);if(web)rows.push([web]);
    rows.push([Markup.button.callback('← Клиенты','clients:0'),Markup.button.callback('Главное меню','home')]);
    await this.reply(ctx,'👤 '+client.name+'\n🏢 '+(client.company||'Компания не указана')+'\n📞 '+(client.phone||'Нет телефона')+'\nБИН/ИИН: '+(client.binIin||'—')+'\nОбъём: '+(client.estimatedVolume??'не указан')+'\nСтатус: '+(labels[client.status]||client.status)+'\n\nСитуация: '+(client.aiSummary||'Нет сводки').slice(0,1200)+'\n\nСледующий шаг: '+(client.aiNextStep||'Уточнить задачу').slice(0,800)+'\n\nПереписок: '+client._count.conversations+' · Сделок: '+client._count.deals,{...Markup.inlineKeyboard(rows)});
  }
  private async styles(ctx:Context,id:string){
    this.session(ctx).activeClientId=id;
    const client=await prisma.client.findUnique({where:{id},select:{name:true}});if(!client)throw new AppError(404,'Клиент не найден');
    await this.reply(ctx,'Что ответить клиенту: '+client.name+'\n\nВыберите стиль или задайте свой вопрос. Будут учтены последние сообщения и база знаний.',{...Markup.inlineKeyboard([
      [Markup.button.callback('Деловой','ai:BUSINESS:'+id),Markup.button.callback('Дружелюбный','ai:FRIENDLY:'+id)],
      [Markup.button.callback('Дожим','ai:CLOSING:'+id),Markup.button.callback('Эксперт','ai:EXPERT:'+id)],
      [Markup.button.callback('✍ Свой вопрос','question:'+id)],[Markup.button.callback('← Карточка','dossier:'+id)],
    ])});
  }
  private async generate(ctx:Context,id:string,style:'BUSINESS'|'FRIENDLY'|'CLOSING'|'EXPERT'='BUSINESS',userPrompt?:string){
    const s=this.session(ctx);if(s.busy){await this.reply(ctx,'Уже обрабатываю запрос. Дождитесь результата.');return;}s.busy=true;
    try{
      await this.reply(ctx,'Готовлю ответ с учётом переписки…');
      const result=await aiOrchestrator.generateSuggestedReply({clientId:id,provider:'AUTO',style,userPrompt});
      await this.reply(ctx,'💡 Готовый ответ для WhatsApp\n\n'+result.reply+'\n\nПочему такой ответ: '+result.explanation,{...Markup.inlineKeyboard([[Markup.button.callback('Ещё вариант','pickreply:'+id),Markup.button.callback('Карточка','dossier:'+id)]])});
    }catch(error){await this.reply(ctx,this.userError(error),{...Markup.inlineKeyboard([[Markup.button.callback('Повторить / выбрать стиль','pickreply:'+id)]])});}
    finally{s.busy=false;s.mode=undefined;}
  }
  private async pipeline(ctx:Context){
    const groups=await prisma.deal.groupBy({by:['stage'],orderBy:{stage:'asc'},_count:true,_sum:{amount:true}});
    await this.reply(ctx,'📊 Воронка сделок\n\n'+Object.entries(stageLabels).map(([stage,label])=>{const g=groups.find(x=>x.stage===stage);return label+': '+(g?g._count:0)+' · '+(g?g._sum.amount||0:0).toLocaleString('ru-RU')+' ₸';}).join('\n')+'\n\nСтатус можно изменить в карточке клиента.',{...Markup.inlineKeyboard([[Markup.button.callback('Открыть клиентов','clients:0'),Markup.button.callback('Главное меню','home')]])});
  }
  private async knowledge(ctx:Context){
    const archive=await activeArchive();
    if(archive){
      const manifest=archive.manifest as any;
      await this.reply(ctx,'📚 База знаний TANBOX\n\nСохранены полные материалы: '+manifest.coverage.categories+' категорий, '+manifest.coverage.documents+' документов. Выберите направление.\n\nИсходники проекта сохранены полностью; юридическая актуальность проверяется отдельно.',{...Markup.inlineKeyboard([
        [Markup.button.callback('🌐 Интернет-база и проверенные правила','webkb:0')],
        ...manifest.categories.map((c:any)=>[Markup.button.callback(c.title,'kdocs:'+c.code+':0')]),
        [Markup.button.callback('Общие материалы и тарифы','kdocs:GENERAL:0')],
        [Markup.button.callback('Главное меню','home')],
      ])});return;
    }
    const items=await prisma.knowledgeItem.findMany({where:{isActive:true},orderBy:{updatedAt:'desc'},take:8,select:{id:true,title:true}});
    await this.reply(ctx,'📚 База знаний\n\nВыберите тарифы или правило. Активные правила учитываются при подготовке ответа.',{...Markup.inlineKeyboard([[Markup.button.callback('💰 Тарифы TANBOX','tariffs')],...items.map(i=>[Markup.button.callback(i.title.slice(0,40),'rule:'+i.id)]),[Markup.button.callback('Главное меню','home')]])});
  }
  private async libraryCategory(ctx:Context,category:string,page:number){
    const batch=await activeArchive();if(!batch){await this.knowledge(ctx);return;}
    const categories=(batch.manifest as any).categories;
    if(category!=='GENERAL'&&!categories.some((c:any)=>c.code===category))throw new AppError(404,'Категория не найдена');
    const where={importId:batch.id,language:{in:['ru','mixed']},categoryCodes:{has:category}};
    const [docs,total]=await prisma.$transaction([
      prisma.knowledgeDocument.findMany({where,skip:page*8,take:8,orderBy:[{kind:'asc'},{title:'asc'},{id:'asc'}],select:{id:true,title:true}}),
      prisma.knowledgeDocument.count({where}),
    ]);
    await this.reply(ctx,'📚 '+(categories.find((c:any)=>c.code===category)?.title||'Общие материалы')+'\n\nМатериалов: '+total+'. Страница '+(page+1)+'. Каждый текст доступен полностью по страницам.',{...Markup.inlineKeyboard([
      ...docs.map(d=>[Markup.button.callback(d.title.slice(0,55),'kread:'+d.id+':0')]),
      [...(page>0?[Markup.button.callback('← Назад','kdocs:'+category+':'+(page-1))]:[]),...(page*8+8<total?[Markup.button.callback('Далее →','kdocs:'+category+':'+(page+1))]:[])],
      [Markup.button.callback('← Все категории','knowledge')],
    ].filter(row=>row.length))});
  }
  private async libraryDocument(ctx:Context,id:string,page:number){
    const document=await archiveDocument(id);
    const pages=splitPassages(document.content,2800);
    if(page>=pages.length)throw new AppError(404,'Страница не найдена');
    await this.reply(ctx,'📄 '+document.title.slice(0,200)+'\nСтраница '+(page+1)+'/'+pages.length+' · Материал проекта, требует проверки актуальности.\n\n'+pages[page],{...Markup.inlineKeyboard([
      [...(page>0?[Markup.button.callback('← Назад','kread:'+id+':'+(page-1))]:[]),...(page+1<pages.length?[Markup.button.callback('Далее →','kread:'+id+':'+(page+1))]:[])],
      [Markup.button.callback('← Материалы категории','kdocs:'+(document.categoryCodes[0]||'GENERAL')+':0')],
      [Markup.button.callback('Все категории','knowledge')],
    ].filter(row=>row.length))});
  }
  private async webKnowledge(ctx:Context,page:number){
    const overview=await webOverview(),categories=overview.categories.slice(page*8,page*8+8);
    await this.reply(ctx,'🌐 Маркировка в Казахстане\n\nИсточников: '+overview.stats.sources+'; текстов получено: '+overview.stats.collected+'; проверенных правил: '+overview.stats.publishedFacts+'.\nТекст источника и проверенное правило имеют разные статусы.',{...Markup.inlineKeyboard([
      ...categories.map(c=>[Markup.button.callback(c.title,'webcat:'+c.code+':0')]),
      [...(page>0?[Markup.button.callback('← Назад','webkb:'+(page-1))]:[]),...(page*8+8<overview.categories.length?[Markup.button.callback('Далее →','webkb:'+(page+1))]:[])],
      [Markup.button.callback('← База знаний','knowledge')],
    ].filter(row=>row.length))});
  }
  private async webCategory(ctx:Context,category:string,page:number){
    const sources=await prisma.webKnowledgeSource.findMany({where:{categoryCodes:{has:category},currentRevisionId:{not:null}},orderBy:[{priority:'asc'},{title:'asc'}],skip:page*8,take:9,select:{title:true,currentRevisionId:true,status:true}});
    const facts=(await usableFacts()).filter(f=>f.categoryCodes.includes(category));
    await this.reply(ctx,'📚 Материалы категории\n\nПроверенных правил: '+facts.length+'. Выберите правило или исходный документ. Правило содержит ответ, условия и основание.',{...Markup.inlineKeyboard([
      ...facts.slice(page*8,page*8+8).map(f=>[Markup.button.callback('✅ '+f.title.slice(0,45),'webfact:'+f.id+':0')]),
      ...sources.slice(0,8).map(s=>[Markup.button.callback((s.status==='READY'?'📄 ':'⚠️ ')+s.title.slice(0,45),'webread:'+s.currentRevisionId+':0')]),
      [...(page>0?[Markup.button.callback('← Назад','webcat:'+category+':'+(page-1))]:[]),...(sources.length>8||facts.length>(page+1)*8?[Markup.button.callback('Далее →','webcat:'+category+':'+(page+1))]:[])],
      [Markup.button.callback('Все категории','webkb:0')],
    ].filter(row=>row.length))});
  }
  private async webRead(ctx:Context,id:string,page:number){
    const document=await prisma.webKnowledgeRevision.findUnique({where:{id},select:{text:true,quality:true,source:{select:{title:true}}}});
    if(!document)throw new AppError(404,'Документ не найден');
    const pages=splitPassages(document.text||'Полный текст не извлечён. Сохранённый оригинал доступен в веб-версии CRM.',2800);
    if(page>=pages.length)throw new AppError(404,'Страница не найдена');
    await this.reply(ctx,document.source.title.slice(0,180)+'\nСтраница '+(page+1)+'/'+pages.length+'. Исходный материал, требуется проверка применимости.\n\n'+pages[page],{...Markup.inlineKeyboard([
      [...(page>0?[Markup.button.callback('← Назад','webread:'+id+':'+(page-1))]:[]),...(page+1<pages.length?[Markup.button.callback('Далее →','webread:'+id+':'+(page+1))]:[])],
      [Markup.button.callback('Все категории','webkb:0')],
    ].filter(row=>row.length))});
  }
  private async webFact(ctx:Context,id:string,page:number){
    const fact=(await usableFacts()).find(f=>f.id===id);
    if(!fact)throw new AppError(404,'Правило требует проверки или больше не опубликовано.');
    const text=fact.title+'\n\n'+fact.answer+'\n\nУсловия: '+JSON.stringify(fact.conditions)+'\n\nОснования:\n'+fact.evidence.map(e=>e.revision.source.title+'\n'+e.locator+'\n'+e.revision.source.url).join('\n\n');
    const pages=splitPassages(text,2800);if(page>=pages.length)throw new AppError(404,'Страница не найдена');
    await this.reply(ctx,'✅ Проверенное правило · '+(page+1)+'/'+pages.length+'\n\n'+pages[page],{...Markup.inlineKeyboard([
      [...(page>0?[Markup.button.callback('← Назад','webfact:'+id+':'+(page-1))]:[]),...(page+1<pages.length?[Markup.button.callback('Далее →','webfact:'+id+':'+(page+1))]:[])],
      [Markup.button.callback('Категории','webkb:0')],
    ].filter(row=>row.length))});
  }
  private async processText(ctx:Context,text:string,targetClientId?:string){
    const s=this.session(ctx);if(s.busy){await this.reply(ctx,'Уже обрабатываю запрос. Подождите завершения.');return;}
    s.busy=true;s.retryText={text,targetClientId};
    try{
      await this.reply(ctx,'Распознаю текст и сохраняю переписку…');
      const result=await aiOrchestrator.ingestTextDialogue({rawText:text,targetClientId,source:'TELEGRAM_BOT'});
      s.activeClientId=result.client.id;s.retryText=undefined;s.pendingText=undefined;s.targetClientId=undefined;s.mode=undefined;
      await this.saved(ctx,result);
    }catch(error){await this.reply(ctx,this.userError(error),{...Markup.inlineKeyboard([[Markup.button.callback('Повторить обработку','retry:text')],[Markup.button.callback('Главное меню','home')]])});}
    finally{s.busy=false;}
  }
  private async cancel(ctx:Context){
    const s=this.session(ctx),key=String(ctx.from!.id),batch=this.batches.get(key);
    if(s.busy){await this.reply(ctx,'Обработка уже началась. Дождитесь результата; новую переписку пока не отправляйте.');return;}
    if(batch){clearTimeout(batch.timer);this.batches.delete(key);}
    s.mode=undefined;s.pendingText=undefined;s.targetClientId=undefined;s.reviewEdit=undefined;
    await this.reply(ctx,'Действие отменено. Выберите пункт меню.');
  }
  private registerHandlers(){
    const bot=this.bot!;
    bot.use(async(ctx,next)=>{
      if(ctx.chat?.type!=='private'||!ctx.from||!isAllowedTelegramUser(ctx.from.id)){if(ctx.chat?.type==='private')await ctx.reply('Доступ к CRM не разрешён.');return;}
      const id=String(ctx.from.id),now=Date.now(),isImage=ctx.message&&('photo' in ctx.message||'document' in ctx.message);
      if(!isImage&&now-(this.userRequests.get(id)||0)<350){if(ctx.callbackQuery)await ctx.answerCbQuery('Подождите немного');return;}
      if(!isImage)this.userRequests.set(id,now);await next();
    });
    bot.command('start',async ctx=>{
      const payload=ctx.message.text.split(/\s+/)[1]||'';
      if(payload.startsWith('login_')){
        const id=idSchema.safeParse(payload.slice(6));
        if(!id.success){await this.login(ctx);return;}
        try{const code=await issueCode(id.data,String(ctx.from.id),ctx.from.username);await this.reply(ctx,'🔐 Код входа: '+code+'\nДействует 5 минут, только для вашего браузера. Никому не передавайте код.\n\nЧтобы работать в боте, выберите действие в меню ниже.');}
        catch(error){await this.reply(ctx,this.userError(error));}return;
      }
      await this.home(ctx);
    });
    bot.command('menu',ctx=>this.home(ctx));bot.command('help',ctx=>this.help(ctx));bot.command('cancel',ctx=>this.cancel(ctx));
    bot.command('upload',ctx=>this.importHelp(ctx));
    bot.command('review',async ctx=>{const draft=await prisma.screenshotDraft.findFirst({where:{telegramUserId:String(ctx.from.id),expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'},select:{id:true}});if(draft)await this.showScreenshotDraft(ctx,draft.id);else await this.reply(ctx,'Нет переписки, ожидающей проверки. Отправьте скриншоты через «Загрузить переписку».');});
    bot.command('clients',async ctx=>{const s=this.session(ctx);s.search=ctx.message.text.split(/\s+/).slice(1).join(' ');await this.clients(ctx,0,'dossier');});
    bot.command('reply',async ctx=>{const s=this.session(ctx);if(s.activeClientId)await this.styles(ctx,s.activeClientId);else await this.clients(ctx,0,'reply');});
    bot.command('pipeline',ctx=>this.pipeline(ctx));bot.command('knowledge',ctx=>this.knowledge(ctx));
    bot.command('login',ctx=>this.login(ctx));bot.command('code',ctx=>this.login(ctx));
    bot.hears(BOT_LABELS.upload,ctx=>this.importHelp(ctx));
    bot.hears(BOT_LABELS.clients,ctx=>{this.session(ctx).search='';return this.clients(ctx,0,'dossier');});
    bot.hears(BOT_LABELS.reply,ctx=>{const s=this.session(ctx);return s.activeClientId?this.styles(ctx,s.activeClientId):this.clients(ctx,0,'reply');});
    bot.hears(BOT_LABELS.pipeline,ctx=>this.pipeline(ctx));bot.hears(BOT_LABELS.knowledge,ctx=>this.knowledge(ctx));
    bot.hears(BOT_LABELS.login,ctx=>this.login(ctx));bot.hears(BOT_LABELS.help,ctx=>this.help(ctx));
    bot.on('photo',ctx=>{const file=ctx.message.photo[ctx.message.photo.length-1];this.enqueueImage(ctx,file.file_id,'image/jpeg');});
    bot.on('document',async ctx=>{
      const f=ctx.message.document;
      if(!['image/png','image/jpeg','image/webp'].includes(f.mime_type||'')){await this.reply(ctx,'Пришлите PNG, JPG или WEBP.');return;}
      if((f.file_size||0)>MAX_FILE_BYTES){await this.reply(ctx,'Файл слишком большой: допустимо до 10 МБ.');return;}
      this.enqueueImage(ctx,f.file_id,f.mime_type!);
    });
    bot.on('text',async ctx=>{
      const text=ctx.message.text.trim();if(text.startsWith('/')){await this.help(ctx);return;}
      if(text.length>50000){await this.reply(ctx,'Переписка должна быть до 50 000 символов. Разделите её на части.');return;}
      const s=this.session(ctx);
      if(s.reviewEdit){
        const edit=s.reviewEdit;
        if(!text){await this.reply(ctx,'Пришлите непустой текст.');return;}
        const limit=edit.field==='content'?10000:edit.field==='summary'?5000:2000;
        if(text.length>limit){await this.reply(ctx,'Слишком длинный текст: максимум '+limit+' символов.');return;}
        await updateTelegramScreenshotDraft(edit.draftId,String(ctx.from.id),parsed=>{
          if(edit.field==='content'){
            if(edit.index===undefined||!parsed.messages[edit.index])throw new AppError(404,'Сообщение не найдено');
            const messages=[...parsed.messages];messages[edit.index]={...messages[edit.index],content:text};return {...parsed,messages};
          }
          return {...parsed,[edit.field]:text};
        });
        s.reviewEdit=undefined;
        await this.showScreenshotDraft(ctx,edit.draftId,Math.floor((edit.index||0)/6));return;
      }
      if(s.mode==='search'){s.search=text;s.mode=undefined;await this.clients(ctx,0);return;}
      if(s.mode==='question'&&s.activeClientId){await this.generate(ctx,s.activeClientId,'BUSINESS',text);return;}
      if(s.mode==='import'){await this.processText(ctx,text,s.targetClientId);return;}
      s.pendingText=text;
      const rows=[[Markup.button.callback('💾 Сохранить как переписку','confirm:text')]];
      if(s.activeClientId)rows.push([Markup.button.callback('💡 Вопрос по активному клиенту','confirm:question')]);
      rows.push([Markup.button.callback('Отмена','cancel')]);
      await this.reply(ctx,'Получил текст. Что с ним сделать?',{...Markup.inlineKeyboard(rows)});
    });
    bot.action('home',async ctx=>{await ctx.answerCbQuery();await this.home(ctx);});
    bot.action('cancel',async ctx=>{await ctx.answerCbQuery();await this.cancel(ctx);});
    bot.action('import:auto',async ctx=>{await ctx.answerCbQuery();await this.importHelp(ctx);});
    bot.action('attach',async ctx=>{await ctx.answerCbQuery();this.session(ctx).search='';await this.clients(ctx,0,'attach');});
    bot.action('search',async ctx=>{await ctx.answerCbQuery();this.session(ctx).mode='search';await this.reply(ctx,'Введите имя, телефон, БИН или компанию для поиска. /cancel — отмена.');});
    bot.action('search:clear',async ctx=>{await ctx.answerCbQuery();this.session(ctx).search='';await this.clients(ctx,0);});
    bot.action(/^clients:(\d+)$/,async ctx=>{await ctx.answerCbQuery();await this.clients(ctx,Math.min(1e7,Number(ctx.match[1])));});
    bot.action(/^(dossier|pickreply|pickattach|question|history|status|price):(.+)$/,async ctx=>{
      await ctx.answerCbQuery();const action=ctx.match[1],id=idSchema.parse(ctx.match[2]),s=this.session(ctx);
      if(action==='dossier'){await this.card(ctx,id);return;}
      if(action==='pickreply'){await this.styles(ctx,id);return;}
      if(action==='price'){
        const result=await quoteForReply(id),web=this.webLink('/clients/'+id+'?tab=pricing');
        await this.reply(ctx,result.evidence?quoteText(result.evidence.calculation):'Расчёт стоимости пока не подготовлен или требует обновления. Откройте веб-карточку клиента → «Расчёт стоимости».',{
          ...Markup.inlineKeyboard([...(web?[[web]]:[]),[Markup.button.callback('💡 Подготовить ответ','pickreply:'+id)],[Markup.button.callback('← Карточка','dossier:'+id)]])});return;
      }
      if(action==='pickattach'){await this.importHelp(ctx,id);return;}
      if(action==='question'){s.activeClientId=id;s.mode='question';await this.reply(ctx,'Напишите, что нужно подготовить для клиента. Например: «Уточни сроки и запроси реквизиты». /cancel — отмена.');return;}
      if(action==='history'){
        const chunk=await prisma.conversationChunk.findFirst({where:{clientId:id},orderBy:{createdAt:'desc'},include:{messages:{orderBy:[{position:'desc'},{id:'desc'}],take:20}}});
        await this.reply(ctx,chunk?'🕘 Последняя переписка\n\n'+chunk.messages.reverse().map(m=>(m.sender==='CLIENT'?'Клиент: ':'Менеджер: ')+m.content).join('\n\n'):'Переписок пока нет.',{...Markup.inlineKeyboard([[Markup.button.callback('← Карточка','dossier:'+id)]])});return;
      }
      await this.reply(ctx,'Выберите новый статус клиента:',{...Markup.inlineKeyboard(clientStatuses.map(status=>[Markup.button.callback(labels[status],'setstatus:'+status+':'+id)]))});
    });
    bot.action(/^setstatus:([A-Z_]+):(.+)$/,async ctx=>{
      await ctx.answerCbQuery();const status=z.enum(clientStatuses).parse(ctx.match[1]),id=idSchema.parse(ctx.match[2]);
      await prisma.$transaction(async tx=>{await tx.client.update({where:{id},data:{status}});const d=await tx.deal.findFirst({where:{clientId:id},orderBy:{updatedAt:'desc'}});if(d)await tx.deal.update({where:{id:d.id},data:{stage:statusToStage[status]}});});await this.card(ctx,id);
    });
    bot.action(/^ai:(BUSINESS|FRIENDLY|CLOSING|EXPERT):(.+)$/,async ctx=>{await ctx.answerCbQuery();await this.generate(ctx,idSchema.parse(ctx.match[2]),ctx.match[1] as 'BUSINESS'|'FRIENDLY'|'CLOSING'|'EXPERT');});
    bot.action(/^(reply|closing):(.+)$/,async ctx=>{await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[2]);if(ctx.match[1]==='closing')await this.generate(ctx,id,'CLOSING');else await this.styles(ctx,id);});
    bot.action('confirm:text',async ctx=>{await ctx.answerCbQuery();const s=this.session(ctx);if(!s.pendingText){await this.reply(ctx,'Текст уже обработан. Отправьте новую переписку.');return;}await this.processText(ctx,s.pendingText,s.targetClientId);});
    bot.action('confirm:question',async ctx=>{await ctx.answerCbQuery();const s=this.session(ctx);if(s.activeClientId&&s.pendingText){const text=s.pendingText;s.pendingText=undefined;await this.generate(ctx,s.activeClientId,'BUSINESS',text);}});
    bot.action('retry:text',async ctx=>{await ctx.answerCbQuery();const s=this.session(ctx);if(s.retryText)await this.processText(ctx,s.retryText.text,s.retryText.targetClientId);else await this.importHelp(ctx);});
    bot.action('retry:images',async ctx=>{await ctx.answerCbQuery();const s=this.session(ctx);if(!s.retryImages){await this.importHelp(ctx);return;}if(s.busy){await this.reply(ctx,'Обработка ещё идёт.');return;}const key=String(ctx.from.id);this.batches.set(key,{ctx,files:s.retryImages.files,targetClientId:s.retryImages.targetClientId,timer:undefined as unknown as NodeJS.Timeout});await this.processBatch(key);});
    bot.action(/^sr:page:([0-9a-f-]{36}):(\d{1,3})$/,async ctx=>{await ctx.answerCbQuery();await this.showScreenshotDraft(ctx,idSchema.parse(ctx.match[1]),Number(ctx.match[2]));});
    bot.action(/^sr:msg:([0-9a-f-]{36}):(\d{1,3})$/,async ctx=>{await ctx.answerCbQuery();await this.showScreenshotMessage(ctx,idSchema.parse(ctx.match[1]),Number(ctx.match[2]));});
    bot.action(/^sr:role:([0-9a-f-]{36}):(\d{1,3}):([CM])$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]),index=Number(ctx.match[2]),sender=ctx.match[3]==='C'?'CLIENT':'MANAGER';
      await updateTelegramScreenshotDraft(id,String(ctx.from.id),parsed=>{if(!parsed.messages[index])throw new AppError(404,'Сообщение не найдено');const messages=[...parsed.messages];messages[index]={...messages[index],sender,senderName:undefined};return {...parsed,messages};});
      await this.showScreenshotMessage(ctx,id,index);
    });
    bot.action(/^sr:move:([0-9a-f-]{36}):(\d{1,3}):([ud])$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]),index=Number(ctx.match[2]),target=index+(ctx.match[3]==='u'?-1:1);
      const updated=await updateTelegramScreenshotDraft(id,String(ctx.from.id),parsed=>{if(!parsed.messages[index])throw new AppError(404,'Сообщение не найдено');if(target<0||target>=parsed.messages.length)return parsed;const messages=[...parsed.messages];[messages[index],messages[target]]=[messages[target],messages[index]];return {...parsed,messages};});
      await this.showScreenshotMessage(ctx,id,target<0||target>=updated.messages.length?index:target);
    });
    bot.action(/^sr:del:([0-9a-f-]{36}):(\d{1,3})$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]),index=Number(ctx.match[2]);
      await updateTelegramScreenshotDraft(id,String(ctx.from.id),parsed=>{if(!parsed.messages[index])throw new AppError(404,'Сообщение не найдено');if(parsed.messages.length===1)throw new AppError(400,'Нельзя удалить последнее сообщение');return {...parsed,messages:parsed.messages.filter((_,i)=>i!==index)};});
      await this.showScreenshotDraft(ctx,id,Math.floor(index/6));
    });
    bot.action(/^sr:text:([0-9a-f-]{36}):(\d{1,3})$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]),index=Number(ctx.match[2]),draft=await getTelegramScreenshotDraft(id,String(ctx.from.id));
      if(!parsedConversationSchema.parse(draft.parsed).messages[index])throw new AppError(404,'Сообщение не найдено');
      this.session(ctx).reviewEdit={draftId:id,index,field:'content'};
      await this.reply(ctx,'Отправьте исправленный текст сообщения '+(index+1)+' одним сообщением. /cancel — выйти из правки.');
    });
    bot.action(/^sr:(summary|next):([0-9a-f-]{36})$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[2]);await getTelegramScreenshotDraft(id,String(ctx.from.id));
      this.session(ctx).reviewEdit={draftId:id,field:ctx.match[1]==='summary'?'summary':'nextStep'};
      await this.reply(ctx,ctx.match[1]==='summary'?'Отправьте исправленную сводку переписки.':'Отправьте исправленный следующий шаг.');
    });
    bot.action(/^sr:save:([0-9a-f-]{36})$/,async ctx=>{
      await ctx.answerCbQuery();const s=this.session(ctx);if(s.busy){await this.reply(ctx,'Сохранение уже идёт.');return;}s.busy=true;
      try{const result=await commitTelegramScreenshotDraft(idSchema.parse(ctx.match[1]),String(ctx.from.id));s.reviewEdit=undefined;s.activeClientId=result.client.id;await this.saved(ctx,result);}
      finally{s.busy=false;}
    });
    bot.action(/^sr:cancel:([0-9a-f-]{36})$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]),s=this.session(ctx);if(s.busy){await this.reply(ctx,'Дождитесь завершения сохранения.');return;}
      await discardScreenshotDraft(id,String(ctx.from.id));s.reviewEdit=undefined;await this.reply(ctx,'Черновик и его скриншоты удалены. Данные в CRM не добавлены.');
    });
    bot.action(/^deleteconfirm:(.+)$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]);
      const client=await prisma.client.findUnique({where:{id},select:{name:true}});
      if(!client){await this.reply(ctx,'Клиент уже удалён.');return;}
      await this.reply(ctx,'Удалить «'+client.name+'» полностью?\n\nБудут удалены клиент / лид, все его сделки, переписка, AI-подсказки и скриншоты. Отменить действие в CRM нельзя.',{...Markup.inlineKeyboard([[Markup.button.callback('Удалить полностью','deleteclient:'+id)],[Markup.button.callback('Отмена — к карточке','dossier:'+id)]])});
    });
    bot.action(/^deleteclient:(.+)$/,async ctx=>{
      await ctx.answerCbQuery();const id=idSchema.parse(ctx.match[1]),s=this.session(ctx);
      if(s.busy){await this.reply(ctx,'Дождитесь завершения текущей обработки перед удалением.');return;}
      const result=await deleteClientCompletely(id);
      if(s.activeClientId===id)s.activeClientId=undefined;
      if(s.targetClientId===id)s.targetClientId=undefined;
      if(s.retryText?.targetClientId===id)s.retryText=undefined;
      if(s.retryImages?.targetClientId===id)s.retryImages=undefined;
      const key=String(ctx.from.id),batch=this.batches.get(key);
      if(batch?.targetClientId===id){clearTimeout(batch.timer);this.batches.delete(key);}
      await this.reply(ctx,result.cleanupPending?'Клиент удалён. '+result.cleanupPending+' скриншотов ожидают повторной очистки и уже недоступны в CRM.':'Клиент, сделки, переписка и скриншоты удалены.',{...Markup.inlineKeyboard([[Markup.button.callback('К списку клиентов','clients:0')]])});
    });
    bot.action('tariffs',async ctx=>{await ctx.answerCbQuery();await this.reply(ctx,'💰 Тарифы TANBOX\n\n'+Object.values(TANBOX_KNOWLEDGE.tariffs).join('\n\n'),{...Markup.inlineKeyboard([[Markup.button.callback('← База знаний','knowledge')]])});});
    bot.action('knowledge',async ctx=>{await ctx.answerCbQuery();await this.knowledge(ctx);});
    bot.action(/^kdocs:([a-zA-Z_]+):(\d{1,5})$/,async ctx=>{await ctx.answerCbQuery();await this.libraryCategory(ctx,ctx.match[1],Number(ctx.match[2]));});
    bot.action(/^kread:([0-9a-f-]+):(\d{1,5})$/,async ctx=>{await ctx.answerCbQuery();await this.libraryDocument(ctx,idSchema.parse(ctx.match[1]),Number(ctx.match[2]));});
    bot.action(/^webkb:(\d{1,5})$/,async ctx=>{await ctx.answerCbQuery();await this.webKnowledge(ctx,Number(ctx.match[1]));});
    bot.action(/^webcat:([a-zA-Z_]+):(\d{1,5})$/,async ctx=>{await ctx.answerCbQuery();await this.webCategory(ctx,ctx.match[1],Number(ctx.match[2]));});
    bot.action(/^webread:([0-9a-f-]+):(\d{1,5})$/,async ctx=>{await ctx.answerCbQuery();await this.webRead(ctx,idSchema.parse(ctx.match[1]),Number(ctx.match[2]));});
    bot.action(/^webfact:([0-9a-f-]+):(\d{1,5})$/,async ctx=>{await ctx.answerCbQuery();await this.webFact(ctx,idSchema.parse(ctx.match[1]),Number(ctx.match[2]));});
    bot.action(/^rule:(.+)$/,async ctx=>{await ctx.answerCbQuery();const item=await prisma.knowledgeItem.findFirst({where:{id:idSchema.parse(ctx.match[1]),isActive:true}});await this.reply(ctx,item?item.title+'\n\n'+item.content:'Правило не найдено.',{...Markup.inlineKeyboard([[Markup.button.callback('← База знаний','knowledge')]])});});
    bot.catch(async(error,ctx)=>{console.warn('Telegram handler failed:',this.safeError(error));await this.reply(ctx,this.userError(error)).catch(()=>{});});
  }
  private async saved(ctx:Context,result:{client:{id:string;name:string};parsed:{summary:string;nextStep:string};duplicate:boolean}){
    try{
      await this.reply(ctx,(result.duplicate?'Эта переписка уже была сохранена.':'✅ Переписка сохранена, сделка добавлена в CRM.')+'\n\nКлиент: '+result.client.name+'\n'+result.parsed.summary+'\n\nСледующий шаг: '+result.parsed.nextStep,{...Markup.inlineKeyboard([[Markup.button.callback('💡 Что ответить','pickreply:'+result.client.id)],[Markup.button.callback('Открыть карточку','dossier:'+result.client.id),Markup.button.callback('Добавить переписку','pickattach:'+result.client.id)]])});
    }catch{console.warn('Telegram result notification failed after successful save');}
  }
  private async showScreenshotDraft(ctx:Context,id:string,page=0){
    const draft=await getTelegramScreenshotDraft(id,String(ctx.from!.id));
    const parsed=parsedConversationSchema.parse(draft.parsed),pages=Math.ceil(parsed.messages.length/6);
    const current=Math.max(0,Math.min(page,pages-1)),start=current*6;
    const lines=parsed.messages.slice(start,start+6).map((m,i)=>`${start+i+1}. ${m.sender==='CLIENT'?'👤 Клиент':'🧑‍💼 Я'}${m.time?' · '+m.time:''}\n${m.content.slice(0,350)}${m.content.length>350?'…':''}`);
    const rows:InlineKeyboardButton[][]=parsed.messages.slice(start,start+6).map((_,i)=>[Markup.button.callback(`✏️ Сообщение ${start+i+1}`,'sr:msg:'+id+':'+(start+i))]);
    const nav:InlineKeyboardButton[]=[];
    if(current>0)nav.push(Markup.button.callback('← Раньше','sr:page:'+id+':'+(current-1)));
    if(current+1<pages)nav.push(Markup.button.callback('Позже →','sr:page:'+id+':'+(current+1)));
    if(nav.length)rows.push(nav);
    rows.push([Markup.button.callback('✍️ Исправить сводку','sr:summary:'+id),Markup.button.callback('✍️ Следующий шаг','sr:next:'+id)]);
    rows.push([Markup.button.callback('✅ Сохранить в CRM','sr:save:'+id)]);
    rows.push([Markup.button.callback('❌ Удалить черновик','sr:cancel:'+id)]);
    await this.reply(ctx,`📋 Черновик переписки · ${current+1}/${pages}\nКлиент: ${parsed.clientName}${parsed.phone?' · '+parsed.phone:''}\n\n${lines.join('\n\n')}\n\nСводка: ${parsed.summary.slice(0,350)}\nСледующий шаг: ${parsed.nextStep.slice(0,250)}\n\nПроверьте каждое сообщение перед сохранением. Черновик действует 30 минут.`,{...Markup.inlineKeyboard(rows)});
  }
  private async showScreenshotMessage(ctx:Context,id:string,index:number){
    const draft=await getTelegramScreenshotDraft(id,String(ctx.from!.id));
    const parsed=parsedConversationSchema.parse(draft.parsed),message=parsed.messages[index];
    if(!message)throw new AppError(404,'Сообщение не найдено');
    const rows:InlineKeyboardButton[][]=[
      [Markup.button.callback('👤 Клиент','sr:role:'+id+':'+index+':C'),Markup.button.callback('🧑‍💼 Я','sr:role:'+id+':'+index+':M')],
      [Markup.button.callback('✍️ Исправить текст','sr:text:'+id+':'+index)],
      [Markup.button.callback('⬆️ Раньше','sr:move:'+id+':'+index+':u'),Markup.button.callback('⬇️ Позже','sr:move:'+id+':'+index+':d')],
      [Markup.button.callback('🗑 Удалить лишнее','sr:del:'+id+':'+index)],
      [Markup.button.callback('← К списку','sr:page:'+id+':'+Math.floor(index/6))],
    ];
    await this.reply(ctx,`Сообщение ${index+1}/${parsed.messages.length}\nАвтор: ${message.sender==='CLIENT'?'клиент':'я / менеджер'}\nВремя: ${message.time||'не указано'}\n\n${message.content}`,{...Markup.inlineKeyboard(rows)});
  }
  private enqueueImage(ctx:Context,id:string,mime:string){
    const key=String(ctx.from!.id),s=this.session(ctx);
    if(s.busy){void this.reply(ctx,'Обработка предыдущего запроса ещё идёт. Отправьте новую пачку после результата.').catch(()=>{});return;}
    let batch=this.batches.get(key);
    if(batch){
      if(batch.files.length>=MAX_FILES){void this.reply(ctx,'В одной пачке до 15 изображений.').catch(()=>{});return;}
      clearTimeout(batch.timer);batch.files.push({id,mime,messageId:ctx.message?.message_id});
    }else{
      batch={ctx,files:[{id,mime,messageId:ctx.message?.message_id}],targetClientId:s.targetClientId,timer:undefined as unknown as NodeJS.Timeout};
      this.batches.set(key,batch);
      void this.reply(ctx,'📥 Получаю скриншоты. Пришлите остальные изображения этой беседы; после короткой паузы начну распознавание.').catch(()=>{});
    }
    batch.timer=setTimeout(()=>{void this.processBatch(key).catch(()=>console.warn('Telegram batch failed'));},2500);
  }
  private async processBatch(key:string){
    const batch=this.batches.get(key);if(!batch)return;
    const s=this.session(batch.ctx);
    if(s.busy){batch.timer=setTimeout(()=>void this.processBatch(key),2000);return;}
    this.batches.delete(key);s.busy=true;s.retryImages={files:batch.files,targetClientId:batch.targetClientId};
    let images:Awaited<ReturnType<typeof prepareImages>>=[];
    try{
      await this.reply(batch.ctx,'🔎 Распознаю '+batch.files.length+' изображений…');
      const inputs:{buffer:Buffer;mimeType:string}[]=[];let total=0;
      for(const file of [...batch.files].sort((a,b)=>(a.messageId||0)-(b.messageId||0))){
        const link=await this.bot!.telegram.getFileLink(file.id);
        const response=await fetch(link.href,{signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new AppError(502,'Не удалось скачать изображение из Telegram');
        const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;total+=value.length;if(size>MAX_FILE_BYTES||total>MAX_TOTAL_BYTES)throw new AppError(413,'Допускается до 10 МБ на файл, до 40 МБ суммарно');chunks.push(value);}}
        finally{await reader.cancel().catch(()=>{});}
        inputs.push({buffer:Buffer.concat(chunks),mimeType:file.mime});
      }
      images=await prepareImages(inputs);
      const preview=await aiOrchestrator.previewScreenshots({images,targetClientId:batch.targetClientId,source:'TELEGRAM_BOT'});
      if(preview.duplicate&&preview.result){
        await deleteImages(images.map(i=>i.url));images=[];
        s.retryImages=undefined;s.targetClientId=undefined;s.mode=undefined;s.activeClientId=preview.result.client.id;
        await this.saved(batch.ctx,preview.result);
      }else if(preview.parsed&&preview.reviewToken){
        const draft=await createTelegramScreenshotDraft(key,images,preview.parsed,preview.reviewToken,batch.targetClientId);
        images=[];s.retryImages=undefined;s.targetClientId=undefined;s.mode=undefined;
        await this.showScreenshotDraft(batch.ctx,draft.id);
      }else throw new AppError(502,'Не удалось подготовить черновик переписки');
    }catch(error){await deleteImages(images.map(i=>i.url));await this.reply(batch.ctx,this.userError(error),{...Markup.inlineKeyboard([[Markup.button.callback('Повторить эту пачку','retry:images')],[Markup.button.callback('Главное меню','home')]])}).catch(()=>{});}
    finally{s.busy=false;}
  }
  private async acquireLease(){
    await prisma.systemSetting.upsert({where:{key:this.leaseKey},create:{key:this.leaseKey,value:''},update:{}});
    const old=await prisma.systemSetting.findUniqueOrThrow({where:{key:this.leaseKey}});
    let value:{owner?:string;expires?:number}={};try{value=JSON.parse(old.value||'{}');}catch{}
    if(value.owner!==this.owner&&(value.expires||0)>Date.now())return false;
    const update=await prisma.systemSetting.updateMany({where:{key:this.leaseKey,value:old.value},data:{value:JSON.stringify({owner:this.owner,expires:Date.now()+45000})}});
    return update.count===1;
  }
  private scheduleRetry(){
    if(this.retryTimer)clearTimeout(this.retryTimer);
    if(!this.stopping)this.retryTimer=setTimeout(()=>void this.start(),60000);
  }
  async start(){
    if(!this.bot||!env.TELEGRAM_POLLING){this.state=this.bot?'disabled':'unconfigured';return;}
    if(this.running||this.starting||this.stopping)return;
    this.starting=true;
    if(this.retryTimer)clearTimeout(this.retryTimer);
    try{
      if(!await this.acquireLease()){this.state='another-instance';this.starting=false;this.scheduleRetry();return;}
      this.state='connecting';
      this.leaseTimer=setInterval(()=>{void this.acquireLease().then(ok=>{if(!ok)throw new Error('lease lost');}).catch(()=>{this.running=false;this.starting=false;this.state='unavailable';if(this.leaseTimer)clearInterval(this.leaseTimer);try{this.bot!.stop('Lease lost');}catch{}this.scheduleRetry();});},15000);
      await this.bot.telegram.setMyCommands([{command:'menu',description:'Главное меню'},{command:'upload',description:'Добавить переписку'},{command:'review',description:'Проверить скриншоты'},{command:'clients',description:'Клиенты и поиск'},{command:'reply',description:'Что ответить клиенту'},{command:'pipeline',description:'Воронка сделок'},{command:'knowledge',description:'Тарифы и база знаний'},{command:'login',description:'Вход в веб-панель'},{command:'help',description:'Как пользоваться'}]).catch(()=>console.warn('Cannot update bot command menu'));
      this.bot.launch({dropPendingUpdates:false},()=>{this.state='connecting';}).catch(error=>{
        this.running=false;this.starting=false;this.state=(error?.response?.error_code||error?.code)===409?'conflict':'unavailable';
        console.warn('Telegram polling unavailable:',this.safeError(error));
        if(this.leaseTimer)clearInterval(this.leaseTimer);
        this.scheduleRetry();
      });
    }catch(error){this.starting=false;this.state='unavailable';console.warn('Telegram startup unavailable:',this.safeError(error));this.scheduleRetry();}
  }
  async stop(){
    this.stopping=true;
    if(this.retryTimer)clearTimeout(this.retryTimer);
    if(this.leaseTimer)clearInterval(this.leaseTimer);
    for(const batch of this.batches.values())clearTimeout(batch.timer);
    this.batches.clear();
    try{this.bot?.stop('Shutdown');}catch{}
    this.running=false;this.state='stopped';
    const old=await prisma.systemSetting.findUnique({where:{key:this.leaseKey}});
    if(old){let value;try{value=JSON.parse(old.value);}catch{}if(value?.owner===this.owner)await prisma.systemSetting.updateMany({where:{key:this.leaseKey,value:old.value},data:{value:''}});}
  }
}
export const telegramBotService=new TelegramBotService();

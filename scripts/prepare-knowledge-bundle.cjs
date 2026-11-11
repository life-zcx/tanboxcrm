const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ts=require('../backend/node_modules/typescript');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../../tanbox'));
const target=path.join(__dirname,'../backend/data/knowledge-bundle.json');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const dataDir='frontend-landing/src/data';
const sourcePaths=new Set(fs.readdirSync(path.join(root,dataDir)).filter(f=>/\.(ts|json)$/.test(f)).map(f=>dataDir+'/'+f));
[
  'frontend-landing/src/pages/ServicesPage.tsx','frontend-landing/src/pages/CalculatorPage.tsx',
  'frontend-landing/src/components/landing/CalculatorSection.tsx','frontend-landing/src/components/landing/PricingTable.tsx',
  'frontend-landing/src/components/landing/FaqSection.tsx','frontend-landing/src/components/modals/TariffHelpModal.tsx',
  'frontend-landing/src/context/LanguageContext.tsx','frontend-landing/src/context/PublicPricingContext.tsx',
  'frontend-landing/src/hooks/useCalculator.ts','frontend-landing/src/utils/seoPaths.ts',
  'frontend-lk/src/data/categories.ts','frontend-lk/src/data/categoryStickerSpecs.ts',
  'frontend-lk/src/components/modals/TariffHelpModal.tsx','backend/src/config/categorySchemas.ts',
  'backend/src/utils/pricing.ts','backend/src/controllers/tariffs.controller.ts','shared/orderNotes.ts',
  'shared/companyConfig.ts','is_mpt_api_complete_with_schemas.md','is_mpt_text_documentation.md',
  'frontend-landing/src/pages/CategoryDetailPage.tsx','frontend-landing/src/pages/CategoriesPage.tsx',
  'frontend-landing/src/pages/TariffsPage.tsx','frontend-landing/src/pages/TermsPage.tsx',
  'frontend-landing/src/pages/PaymentProcedurePage.tsx','frontend-landing/src/pages/ContactsPage.tsx',
].forEach(p=>sourcePaths.add(p));
const snapshots=new Map([...sourcePaths].map(p=>[p,fs.readFileSync(path.join(root,p))]));
const cache=new Map();
const enumValues=['SHOES','TEXTILE','WATER','MEDICINE','TOBACCO','BEER','DIETARY_SUPPLEMENTS','OILS','JEWELRY','SAIGA','OTHER'];
function load(relative){
  relative=relative.replaceAll('\\','/');
  if(!sourcePaths.has(relative))throw Error('Unlisted data module: '+relative);
  if(cache.has(relative))return cache.get(relative).exports;
  const module={exports:{}};cache.set(relative,module);
  const filename=path.join(root,relative);
  const code=ts.transpileModule(snapshots.get(relative).toString('utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require','module',code)(module.exports,name=>{
    if(name==='@prisma/client'&&relative==='backend/src/config/categorySchemas.ts')return {OrderCategory:Object.fromEntries(enumValues.map(k=>[k,k]))};
    if(!name.startsWith('.'))throw Error('Unexpected executable dependency: '+name);
    const resolved=path.resolve(path.dirname(filename),name+'.ts');
    return load(path.relative(root,resolved));
  },module);
  return module.exports;
}
const codes={shoes:'SHOES',textile:'TEXTILE',pharma:'MEDICINE',water:'WATER',tobacco:'TOBACCO',beer:'BEER',oils:'OILS',bad:'DIETARY_SUPPLEMENTS',jewelry:'JEWELRY',saiga:'SAIGA',timber:'TIMBER',lpg:'LPG'};
const issues={water:['В исходной категории и исправленной статье различаются утверждения об обязательности. Требуется сверка перечня по конкретному товару.'],textile:['Условия маркировки на складе и переходные положения требуют проверки по действующей процедуре.'],jewelry:['Способ нанесения, остатки и таможенные условия необходимо сверить с окончательными правилами.'],timber:['Планируемый срок внедрения нельзя считать действующей обязанностью без проверки окончательного акта.'],lpg:['Нужно сверить окончательные сроки и условия после пилота.']};
const labels={title:'Название',shortTitle:'Краткое название',fullDesc:'Полное описание',shortDesc:'Описание',status:'Статус в исходнике',statusText:'Описание статуса',dateFull:'Срок в исходнике',tnved:'ТН ВЭД',stages:'Этапы',processSteps:'Порядок работы',keyFeatures:'Особенности',faq:'Вопросы и ответы',q:'Вопрос',a:'Ответ',contentSections:'Полный текст',content:'Текст',equipmentNotes:'Оборудование',wmsNotes:'Складской учёт',date:'Дата',desc:'Описание',step:'Шаг'};
function render(value,level=0){
  if(value===null)return '—';
  if(Array.isArray(value))return value.map((v,i)=>String(i+1)+'. '+render(v,level+1)).join('\n\n');
  if(typeof value==='object')return Object.entries(value).map(([k,v])=>(labels[k]||k)+':\n'+render(v,level+1)).join('\n\n');
  return String(value);
}
const documents=[];
function add(key,kind,language,title,categoryCodes,payload,paths,notes=[]){
  // Never shorten content; original payload and source bytes are both retained.
  const clean=JSON.parse(JSON.stringify(payload));
  const content=typeof clean==='string'?clean:render(clean);
  const document={key,kind,language,title,categoryCodes,content,payload:clean,sourcePaths:paths,reviewStatus:'SOURCE',issues:notes};
  documents.push({...document,sha256:digest(canonical(document))});
}
async function main(){
  const cm=load(dataDir+'/categoriesData.ts'),am=load(dataDir+'/articlesData.ts');
  const references=load(dataDir+'/regulatoryRequirements.ts');
  const links=load(dataDir+'/contentLinks.ts');
  const categorySources=[dataDir+'/categoriesData.ts',dataDir+'/categoriesLocalization.ts',dataDir+'/categoryStageTranslations.ts'];
  const articleSources=[dataDir+'/articlesData.ts',dataDir+'/articlesLocalization.ts',dataDir+'/articleRevisions.ts'];
  const categories=cm.CATEGORIES_DATA.map(c=>({code:c.id,title:c.shortTitle,aliases:[c.id,c.title,c.shortTitle,codes[c.id]].filter(Boolean)}));
  for(const category of cm.CATEGORIES_DATA){
    for(const lang of ['ru','kz','en']){
      add('category:'+category.id+':'+lang,'CATEGORY',lang,cm.getLocalizedCategory(category,lang).title,[category.id],cm.getLocalizedCategory(category,lang),categorySources,issues[category.id]||[]);
      add('references:'+category.id+':'+lang,'REFERENCES',lang,'Источники: '+cm.getLocalizedCategory(category,lang).shortTitle,[category.id],{checkedAtInSource:references.REQUIREMENTS_CHECKED_AT,sources:references.getRegulatorySources(category.id,lang)},[dataDir+'/regulatoryRequirements.ts'],['Наличие ссылки не означает, что её текущая редакция проверена при импорте.']);
    }
  }
  for(const article of am.ARTICLES_DATA){
    const linked=categories.filter(c=>links.relatedArticleSlug(c.code)===article.slug&&c.code!=='tobacco').map(c=>c.code);
    const targetCategory=links.articleCategoryId(article.slug,article.targetCategoryCode);
    if(codes[targetCategory]&&!linked.includes(targetCategory))linked.push(targetCategory);
    const cats=linked.length?linked:['GENERAL'];
    for(const lang of ['ru','kz','en']){
      const effective=am.getLocalizedArticle(article,lang);
      add('article:'+article.slug+':'+lang,'ARTICLE',lang,effective.title,cats,effective,articleSources,cats.flatMap(c=>issues[c]||[]));
    }
    // Revisions may replace whole sections: preserve the original array entry too.
    add('original:'+article.slug,'ORIGINAL','ru','Исходная редакция: '+article.title,cats,article,[dataDir+'/articlesData.ts'],['Историческая исходная редакция; для ответов не используется.']);
  }
  const schema=load('backend/src/config/categorySchemas.ts').CATEGORY_SCHEMAS;
  const specs=load('frontend-lk/src/data/categoryStickerSpecs.ts');
  for(const category of categories){
    const code=codes[category.code];
    if(schema[code])add('fields:'+category.code,'FIELDS','ru','Поля карточки: '+category.title,[category.code],schema[code],['backend/src/config/categorySchemas.ts']);
    if(enumValues.includes(code)&&code!=='OTHER')add('sticker:'+category.code,'STICKER','ru','Этикетка: '+category.title,[category.code],specs.getCategoryStickerSpecs(code),['frontend-lk/src/data/categoryStickerSpecs.ts']);
  }
  if(schema.OTHER)add('fields:other','FIELDS','ru','Поля карточки: прочие товары',['GENERAL'],schema.OTHER,['backend/src/config/categorySchemas.ts']);
  const faq=load(dataDir+'/homeFaq.ts');
  for(const lang of ['ru','kz','en'])add('faq:'+lang,'FAQ',lang,'Общие вопросы TANBOX',['GENERAL'],faq.getHomeFaq(lang),[dataDir+'/homeFaq.ts']);
  for(const filename of ['frontend-landing/src/pages/ServicesPage.tsx','frontend-landing/src/components/modals/TariffHelpModal.tsx','frontend-lk/src/components/modals/TariffHelpModal.tsx',
    'frontend-landing/src/pages/CategoryDetailPage.tsx','frontend-landing/src/pages/CategoriesPage.tsx','frontend-landing/src/pages/TariffsPage.tsx',
    'frontend-landing/src/pages/TermsPage.tsx','frontend-landing/src/pages/PaymentProcedurePage.tsx','frontend-landing/src/pages/ContactsPage.tsx']){
    const sf=ts.createSourceFile(filename,snapshots.get(filename).toString('utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
    const texts=[];
    function visit(n){if((ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isJsxText(n))&&n.text.trim())texts.push(n.text);ts.forEachChild(n,visit);}visit(sf);
    add('service-text:'+filename,'SERVICE_TEXT','mixed','Полные тексты услуг: '+path.basename(filename),['GENERAL'],texts,[filename],['Сохранены все текстовые литералы страницы; динамические ставки смотрите в снимке прайса.']);
  }
  for(const filename of ['is_mpt_api_complete_with_schemas.md','is_mpt_text_documentation.md'])add('technical:'+filename,'TECHNICAL','ru',filename,['GENERAL'],snapshots.get(filename).toString('utf8'),[filename],['Техническая документация исходного проекта; версия внешнего API при импорте не проверена.']);
  const response=await fetch('https://tanbox.kz/api/tariffs',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Cannot capture active public prices: HTTP '+response.status);
  const responseData=await response.json();
  const pricing=load(dataDir+'/publicPricing.ts').normalizePublicPricing(responseData);
  snapshots.set('public-api/tariffs.json',Buffer.from(JSON.stringify(responseData,null,2)+'\n','utf8'));
  const publicPrices={tariffs:pricing.tariffs.map(t=>({code:t.code,priceRetail:t.priceRetail,priceWholesale:t.priceWholesale,priceLargeWholesale:t.priceLargeWholesale})),pricingSettings:pricing.pricingSettings};
  add('public-pricing','PRICING','ru','Публичные тарифы TANBOX',['GENERAL'],publicPrices,['public-api/tariffs.json',dataDir+'/publicPricing.ts','backend/src/utils/pricing.ts'],['Снимок публичного API. Тарифы оператора, наличие свободных мощностей и юридические требования этим снимком не подтверждаются.']);
  for(const p of sourcePaths)if(digest(fs.readFileSync(path.join(root,p)))!==digest(snapshots.get(p)))throw Error('Source changed while preparing bundle: '+p+'; run again for a consistent snapshot');
  const sources=[...snapshots.keys()].sort().map(p=>{const data=snapshots.get(p);return {path:p,sha256:digest(data),byteLength:data.length,data:data.toString('base64')};});
  const coverage={categories:categories.length,articles:am.ARTICLES_DATA.length,languages:['ru','kz','en'],sourceFiles:sources.length,sourceBytes:sources.reduce((n,s)=>n+s.byteLength,0),documents:documents.length,contentCharacters:documents.reduce((n,d)=>n+d.content.length,0),perCategory:categories.map(c=>({code:c.code,title:c.title,documents:documents.filter(d=>d.categoryCodes.includes(c.code)).length,characters:documents.filter(d=>d.categoryCodes.includes(c.code)).reduce((n,d)=>n+d.content.length,0)}))};
  const manifest={scope:'Full text and original bytes of the enumerated public product, article, service, pricing, product-field and technical-documentation sources from TANBOX. No claim of exhaustive legislation.',categories,coverage,excluded:['.env and credentials','databases, customer records and backups','node_modules, compiled builds and git history','decorative media not containing knowledge text']};
  const bundleHash=digest(canonical({sources:sources.map(s=>({path:s.path,sha256:s.sha256})),documents:documents.map(d=>({key:d.key,sha256:d.sha256})),manifest}));
  const bundle={format:1,bundleHash,capturedAt:new Date().toISOString(),sourceRoot:root,manifest,sources,documents};
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(bundle),'utf8');
  console.log(JSON.stringify({bundle:path.relative(path.join(__dirname,'..'),target),bundleHash,...coverage},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

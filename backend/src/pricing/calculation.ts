import {z} from 'zod';
import {AppError} from '../lib/errors';
export const tariffNames={DIGITAL:'Цифровой',PRINT:'Печать',STANDARD:'Стандарт',PRO:'PRO Склад'} as const;
const numeric=z.union([z.number(),z.string().regex(/^\d+(?:\.\d+)?$/)]).transform(Number);
const price=numeric.pipe(z.number().finite().min(0).max(1e6)).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-6,'Не более двух знаков после запятой');
export const pricingSchema=z.object({
  tariffs:z.array(z.object({code:z.enum(['DIGITAL','PRINT','STANDARD','PRO']),priceRetail:price,priceWholesale:price,priceLargeWholesale:price})).length(4).refine(a=>new Set(a.map(t=>t.code)).size===4),
  pricingSettings:z.object({volumeTier1:numeric.pipe(z.number().int().min(1).max(1e7)),volumeTier2:numeric.pipe(z.number().int().min(2).max(1e7)),ssccPrice:price,stickerLayoutPrice:price,selfLayoutPrice:price,urgentPercent:numeric.pipe(z.number().min(0).max(100)),expressDeliveryPrice:price,outsourcingOneTimePrice:price,outsourcingTier1Price:price.optional(),outsourcingTier2Price:price.optional(),outsourcingTier3Price:price.optional(),outsourcingTier4Price:price.optional(),cardNktPrice:price,cardMptPrice:price,cardFullPackagePrice:price,trainingCoursePrice:price.optional()}).refine(s=>s.volumeTier2>s.volumeTier1),
});
export type Pricing=z.infer<typeof pricingSchema>;
export const calculationInput=z.object({
  tariff:z.enum(['DIGITAL','PRINT','STANDARD','PRO']),itemsCount:z.number().int().min(1).max(1e7),
  cardsCount:z.number().int().min(0).max(1e5).default(0),cardService:z.enum(['NONE','NKT','MPT','FULL']).default('NONE'),
  onboarding:z.boolean().default(false),ssccNeeded:z.boolean().default(false),boxesCount:z.number().int().min(0).max(1e6).default(0),
  layout:z.enum(['NONE','APPROVAL','DESIGN']).default('NONE'),urgent:z.boolean().default(false),delivery:z.boolean().default(false),
  discountAmount:price.default(0),discountReason:z.string().trim().max(500).default(''),
}).strict().superRefine((p,c)=>{
  if((p.cardsCount>0)===(p.cardService==='NONE'))c.addIssue({code:'custom',message:'Выберите услугу карточек и укажите их количество',path:['cardsCount']});
  if(p.ssccNeeded&&p.tariff!=='PRO'&&p.boxesCount<1)c.addIssue({code:'custom',message:'Для агрегации укажите количество коробов',path:['boxesCount']});
  if(!p.ssccNeeded&&p.boxesCount>0)c.addIssue({code:'custom',message:'Количество коробов задано без агрегации',path:['boxesCount']});
  if(p.discountAmount>0&&!p.discountReason)c.addIssue({code:'custom',message:'Для скидки укажите причину',path:['discountReason']});
});
export type CalculationInput=z.infer<typeof calculationInput>;
const cents=(v:number)=>Math.round(v*100);
const money=(v:number)=>v/100;
export function calculateQuote(input:unknown,source:Pricing){
  const p=calculationInput.parse(input),pricing=pricingSchema.parse(source),settings=pricing.pricingSettings;
  if(p.tariff==='PRO'&&p.itemsCount<500)throw new AppError(400,'Минимальная партия PRO Склад — 500 единиц. Для остальных пакетов это ограничение не установлено.');
  const tariff=pricing.tariffs.find(t=>t.code===p.tariff)!;
  const counts=[Math.min(p.itemsCount,settings.volumeTier1),Math.max(0,Math.min(p.itemsCount-settings.volumeTier1,settings.volumeTier2-settings.volumeTier1)),Math.max(0,p.itemsCount-settings.volumeTier2)];
  const rates=[tariff.priceRetail,tariff.priceWholesale,tariff.priceLargeWholesale];
  const brackets=counts.map((count,i)=>({count,rate:rates[i],subtotal:money(count*cents(rates[i]))})).filter(b=>b.count>0);
  const lines:{key:string;title:string;quantity:number;unitPrice:number;total:number}[]=[];
  const add=(key:string,title:string,quantity:number,unitPrice:number)=>{if(quantity)lines.push({key,title,quantity,unitPrice,total:money(quantity*cents(unitPrice))});};
  const marking=brackets.reduce((n,b)=>n+cents(b.subtotal),0);
  lines.push({key:'marking',title:tariffNames[p.tariff],quantity:p.itemsCount,unitPrice:Math.round(marking/p.itemsCount)/100,total:money(marking)});
  const cardRates={NONE:0,NKT:settings.cardNktPrice,MPT:settings.cardMptPrice,FULL:settings.cardFullPackagePrice};
  add('cards','Карточки: '+({NONE:'нет',NKT:'НКТ',MPT:'ИС МПТ',FULL:'полный пакет'}[p.cardService]),p.cardsCount,cardRates[p.cardService]);
  if(p.onboarding)add('onboarding','Первоначальное сопровождение',1,settings.outsourcingOneTimePrice);
  const sscc=p.ssccNeeded&&p.tariff!=='PRO'?p.boxesCount*cents(settings.ssccPrice):0;
  if(sscc)add('sscc','Агрегация SSCC',p.boxesCount,settings.ssccPrice);
  if(p.layout!=='NONE')add('layout',p.layout==='DESIGN'?'Разработка макета':'Проверка макета клиента',1,p.layout==='DESIGN'?settings.stickerLayoutPrice:settings.selfLayoutPrice);
  if(p.delivery)add('delivery','Экспресс-доставка',1,settings.expressDeliveryPrice);
  if(p.urgent)add('urgency','Срочность: '+settings.urgentPercent+'% от маркировки и SSCC',1,Math.round((marking+sscc)/100*settings.urgentPercent/100));
  const beforeDiscount=lines.reduce((n,l)=>n+cents(l.total),0),discount=cents(p.discountAmount);
  if(discount>beforeDiscount)throw new AppError(400,'Скидка превышает стоимость услуг');
  if(!Number.isSafeInteger(beforeDiscount)||beforeDiscount>1e14)throw new AppError(400,'Расчёт превышает допустимую сумму');
  return {input:p,tariffName:tariffNames[p.tariff],brackets,lines,beforeDiscount:money(beforeDiscount),discountAmount:p.discountAmount,discountReason:p.discountReason,total:money(beforeDiscount-discount),averagePerItem:Math.round((beforeDiscount-discount)/p.itemsCount)/100,
    notes:['Предварительный расчёт услуг TANBOX; состав и сроки работ требуют согласования.',
      'Коды маркировки оплачиваются оператору отдельно; сумма оплаты оператору здесь не рассчитана.',
      'Услуги склада и таможенного брокера не включены.',
      'Налоговые условия уточняются при согласовании заказа.',
      'Оборудование и обучение рассчитываются индивидуально и в этот расчёт не включены.',
      ...(p.tariff==='PRO'?['SSCC входит в PRO Склад; повторная плата за него не начислена.']:[])]};
}
export type QuoteCalculation=ReturnType<typeof calculateQuote>;

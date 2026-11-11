import {AppError} from '../lib/errors';
import type {QuoteCalculation} from './calculation';
import type {Pricing} from './calculation';
export const QUOTE_CONDITIONS='Условия расчёта: коды оплачиваются оператору отдельно, склад и таможенный брокер не включены. Оборудование и обучение рассчитываются отдельно. Налоговые условия уточняются при согласовании заказа.';
export function withQuoteConditions(text:string,calculation?:QuoteCalculation|null){
  if(!calculation||!/\d[\d\s.,\u00a0\u202f]*\s*(?:₸|тенге|KZT)/iu.test(text)||text.includes(QUOTE_CONDITIONS))return text;
  return text.trim()+'\n\n'+QUOTE_CONDITIONS;
}
export function validateReplyPrices(texts:string[],calculation?:QuoteCalculation|null,pricing?:Pricing|null){
  const allowed=new Set<number>();
  if(calculation){
    const add=(v:number)=>allowed.add(Math.round(v*100));
    [calculation.total,calculation.beforeDiscount,calculation.discountAmount,calculation.averagePerItem].forEach(add);
    calculation.lines.forEach(l=>{add(l.total);add(l.unitPrice);});
    calculation.brackets.forEach(b=>{add(b.subtotal);add(b.rate);});
    if(calculation.discountAmount) add(-calculation.discountAmount);
  }
  if(pricing)for(const tariff of pricing.tariffs){
    [tariff.priceRetail,tariff.priceWholesale,tariff.priceLargeWholesale].forEach(value=>allowed.add(Math.round(value*100)));
  }
  if(pricing){
    const settings=pricing.pricingSettings;
    [settings.outsourcingOneTimePrice,settings.outsourcingTier1Price,settings.outsourcingTier2Price,settings.outsourcingTier3Price,settings.outsourcingTier4Price,settings.cardNktPrice,settings.cardMptPrice,settings.cardFullPackagePrice,settings.trainingCoursePrice]
      .filter((value):value is number=>typeof value==='number').forEach(value=>allowed.add(Math.round(value*100)));
  }
  for(const text of texts)for(const match of text.matchAll(/([-−]?\d(?:[\d \u00a0\u202f]*\d)?(?:[.,]\d{1,2})?)\s*(?:₸|тенге|KZT)(?![a-z])/giu)){
    const value=Number(match[1].replace(/[ \u00a0\u202f]/g,'').replace('−','-').replace(',','.'));
    if(!allowed.has(Math.round(value*100)))throw new AppError(502,'ИИ предложил сумму, которой нет в действующем серверном расчёте. Ответ не сохранён; проверьте расчёт и повторите.');
  }
}

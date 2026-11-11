import type {QuoteCalculation} from '../pricing/calculation';
import {quoteText} from '../pricing/pricing.service';
import {QUOTE_CONDITIONS} from '../pricing/reply-guard';

const categoryNames:Record<string,string>={SHOES:'обуви',CLOTHES:'одежды и текстиля',MEDICINE:'лекарственных товаров',WATER:'упакованной воды',TOBACCO:'табачной продукции',OTHER:'товара'};

export function buildCommercialOfferDraft(options:{clientName:string;category?:string|null;clientText:string;fullOutsourcing:boolean;warehouse:boolean;almaty:boolean;partyQuantityKnown:boolean;assortmentUnknown:boolean;codesUnknown:boolean;calculation?:QuoteCalculation|null;pricingGuide?:string|null}){
  const product=categoryNames[options.category||'']||(/одежд|текстил/iu.test(options.clientText)?'одежды и текстиля':'товара');
  const equipmentTraining=/обучени|оборудован|принтер/iu.test(options.clientText)&&!/(оклейк|нанесени|этикет|рулон|печать|эмисси)/iu.test(options.clientText);
  const catalogOnly=!equipmentTraining&&/карточк|номенклатур|нкт|gtin/iu.test(options.clientText)&&!/(оклейк|нанесени|этикет|рулон|печать|эмисси|data\s*matrix)/iu.test(options.clientText);
  const scope=options.calculation?.input.tariff==='DIGITAL'?'Эмиссия кодов и подготовка файлов для самостоятельной печати. Печать и нанесение не включены.'
    :options.calculation?.input.tariff==='PRINT'?'Эмиссия кодов и печать рулонов этикеток для самостоятельного нанесения. Оклейка не включена.'
    :options.calculation?.input.tariff==='STANDARD'?'Эмиссия, печать и нанесение этикеток без вскрытия коробов; состав работ уточняется по партии.'
    :options.calculation?.input.tariff==='PRO'?'Эмиссия, печать, вскрытие коробов, сверка артикулов, нанесение и агрегация SSCC; состав работ уточняется по партии.'
    :equipmentTraining?'Обучение сотрудников и подбор оборудования рассматриваются отдельно. Модель принтера, комплектация и программа обучения согласуются до расчёта полной стоимости.'
    :catalogOnly?'Подготовка данных и создание карточек товаров в согласованном каталоге. Количество карточек и необходимые атрибуты уточняются до окончательного расчёта.'
    :'Набор операций определяется после выбора тарифа и проверки условий партии. Дополнительные услуги включаются только после согласования.';
  const parts=[
    'TANBOX · КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ'+(options.calculation?'':options.pricingGuide?' (предварительное, без итоговой суммы)':' (предварительное, без цены)'),
    'Для: '+options.clientName,
    '',
    'Задача клиента\n'+(equipmentTraining?'Организовать самостоятельную маркировку: подобрать оснащение и обучение команды.':catalogOnly?'Подготовить товарные карточки для маркировки '+product+'.':'Маркировка '+product+'.'+(options.fullOutsourcing?' Формат: полный аутсорсинг маркировочных работ.':'')),
    ...(options.warehouse?['Площадка\nРаботы на складе временного хранения обсуждаются; возможность и условия работы на конкретном СВХ согласуются отдельно.']:[]),
    ...(options.almaty?['Город клиента: Алматы.']:[]),
    '',
    'Предварительный состав работ\n'+scope,
    '',
  ];
  if(options.calculation){
    parts.push('Расчёт стоимости\n'+quoteText(options.calculation),'',QUOTE_CONDITIONS);
  }else if(options.pricingGuide){
    parts.push('Стоимость\n'+options.pricingGuide,'','Итоговая сумма пока не рассчитана: объём партии и состав работ требуют подтверждения.','',QUOTE_CONDITIONS);
  }else{
    parts.push('Стоимость\nТочная сумма пока не рассчитана. Для расчёта в CRM нужен ориентировочный объём первой партии в единицах и согласованный состав работ; килограммы или места можно указать дополнительно.');
    parts.push('',QUOTE_CONDITIONS);
  }
  const later=[options.assortmentUnknown?'точный ассортимент':null,options.codesUnknown?'коды ТН ВЭД':null].filter(Boolean);
  if(later.length)parts.push('',`Данные, которые можно уточнить позже\n${later.join(' и ')} — после формирования партии; сейчас они не блокируют предварительное обсуждение.`);
  parts.push('',options.calculation?'Следующий шаг\nПроверьте состав работ и условия расчёта. После согласования подтвердим сроки и порядок выполнения.':options.partyQuantityKnown?'Следующий шаг\nПодтвердите состав работ для партии, после чего подготовим окончательный расчёт.':'Следующий шаг\nПодскажите ориентировочное количество единиц в первой партии. После этого подготовим расчёт и согласуем состав работ.');
  return {reply:parts.join('\n').trim(),explanation:options.calculation?'Черновик КП собран из истории клиента; сумма и состав расчёта взяты из действующего серверного расчёта. Перед отправкой проверьте условия и площадку.':options.pricingGuide?'Черновик КП собран из истории клиента. Ставки взяты из актуального прайса TANBOX; итоговая сумма не названа, поскольку объём и состав работ требуют подтверждения.':'Предварительное КП собрано из истории клиента без выдуманной цены. Для КП с суммой требуется серверный расчёт после уточнения объёма партии.'};
}

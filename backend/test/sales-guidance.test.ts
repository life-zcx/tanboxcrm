import {test} from 'node:test';
import assert from 'node:assert/strict';
import {salesGuidance} from '../src/ai/sales-guidance';
const client=(content:string)=>({sender:'CLIENT',content}),manager=(content:string)=>({sender:'MANAGER',content});
test('sales guidance handles an unanswered offer without claiming rejection or an automatic discount',()=>{
  const result=salesGuidance({category:'bad',messages:[client('БАД, первая партия 20 000, в год 80 000.'),manager('[Документ] КП')],managerTask:'Подготовь повторный контакт: клиент не отвечает после КП'});
  assert.equal(result.key,'followup');assert(result.context.includes('конкретной партии'));assert(result.context.includes('не назначай скидку'));assert(result.context.includes('не доказанный отказ'));assert(result.context.includes('СГР'));
});
test('ready footwear buyer is taken to a next action rather than a new generic questionnaire',()=>{
  const result=salesGuidance({category:'shoes',messages:[client('В Алматы, 200 пар. Мы готовы заказать, значит сразу начнем.') ]});
  assert.equal(result.key,'ready_to_start');assert(result.context.includes('не возвращай клиента'));assert(result.context.includes('ассортимент/ссылки'));assert(!result.context.includes('750 000'));
});
test('manufacturer classification uses client statements and excludes quoted manager claims',()=>{
  assert.equal(salesGuidance({category:'textile',messages:[client('Мы производим, импорт нет у нас.')] }).key,'manufacturer');
  assert.notEqual(salesGuidance({messages:[manager('мы производим'),client('> _Вы: мы производим_\nНет, мы закупаем товар.')] }).key,'manufacturer');
});
test('quote for a director and warehouse enquiries get distinct next steps',()=>{
  assert.equal(salesGuidance({category:'textile',messages:[client('Объем пока неизвестен. Можете КП? Перешлю руководителю.')] }).key,'quote_for_head');
  const warehouse=salesGuidance({category:'bad',messages:[client('Таможенный брокер есть. Нужен склад для авиагруза и стоимость хранения.')] });
  assert.equal(warehouse.key,'warehouse');assert(warehouse.context.includes('не спрашивай повторно'));assert(warehouse.context.includes('требуют подтверждения'));
});
test('ambiguous emoji and Cyrillic КП are recognised without learning a private quote as a tariff',()=>{
  assert.equal(salesGuidance({messages:[client('😱')]}).key,'price_reaction');
  assert.equal(salesGuidance({messages:[client('Можете КП?')]}).key,'pricing');
  assert.equal(salesGuidance({messages:[client('Расскажите про скптехнологии')]}).key,'general');
});
test('empty history and system-only events do not create an invented customer scenario',()=>{
  const result=salesGuidance({messages:[{sender:'SYSTEM',content:'[Звонок]'}]});
  assert.equal(result.key,'general');assert(result.context.includes('При отсутствии содержательной переписки'));assert(result.context.includes('не раскрывает содержимое'));
});
test('equipment and training are distinct from outsourcing and do not turn an individual offer into a price list',()=>{
  const result=salesGuidance({category:'textile',messages:[client('Мы производим одежду, хотим сами печатать. Нужен принтер и обучение сотрудников, без 1С.')]});
  assert.equal(result.key,'equipment_training');assert(result.context.includes('Не навязывай'));assert(result.context.includes('личный кабинет'));assert(result.context.includes('расходные')||result.context.includes('Расходные'));
  for(const privatePrice of ['245 000','145 000','750 000','883 900'])assert(!result.context.includes(privatePrice));
});
test('minimum batch and headline floor prices are not propagated to all services',()=>{
  const result=salesGuidance({messages:[client('Есть 200 пар. Какая стоимость услуги?')]});
  assert.equal(result.key,'pricing');assert(result.context.includes('не равна цене любой партии'));assert(result.context.includes('не распространяется автоматически'));assert(result.context.includes('Оплата кодов оператору'));
});

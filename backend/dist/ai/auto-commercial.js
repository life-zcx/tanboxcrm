"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferAutomaticQuote = inferAutomaticQuote;
exports.publishedTariffGuide = publishedTariffGuide;
const calculation_1 = require("../pricing/calculation");
function serviceFromClient(text) {
    const signals = [];
    const positiveScope = text.replace(/без\s+вскрыти[ея]\s+короб[а-я]*/giu, '');
    if (/\bpro\b|про\s*склад|вскрыти[ея]\s+короб|переупаков|сверк[а-я]*\s+артикул|агрегаци[яю]/iu.test(positiveScope))
        signals.push('PRO');
    if (/тариф\s+стандарт|(?:оклейк|нанесени).{0,70}без\s+вскрыти|без\s+вскрыти.{0,70}(?:оклейк|нанесени)/iu.test(text))
        signals.push('STANDARD');
    if (/только\s+печать|(?:печать|рулон[ыов]).{0,65}наноси[мт]\s+сами/iu.test(text))
        signals.push('PRINT');
    if (/только\s+(?:эмисси|коды)|(?:коды|эмисси).{0,65}печата[емю]\s+сами/iu.test(text))
        signals.push('DIGITAL');
    return signals.length === 1 ? signals[0] : null;
}
function exactPartyCount(messages) {
    for (const message of [...messages].reverse()) {
        if (message.sender !== 'CLIENT')
            continue;
        const content = message.content;
        if (/объ[её]м\s+(?:измен|уточн)|количество\s+(?:измен|уточн)|партия\s+формиру|пока\s+не\s+зна[емю].{0,30}(?:сколько|объ[её]м)/iu.test(content))
            return null;
        if (!/(?:парт|у\s+нас|имеем|будет|нужно|надо|планируем|заказ|товар|обув|одежд)/iu.test(content))
            continue;
        const matches = [...content.matchAll(/(?<!\d)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{1,7})\s*(?:шт(?:ук[аи]?)?|ед(?:иниц[а-я]*)?\.?|пар(?:ы)?)(?![\p{L}\d])/giu)];
        if (!matches.length)
            continue;
        const candidates = matches.filter(match => {
            const before = content.slice(Math.max(0, match.index - 25), match.index);
            const around = content.slice(Math.max(0, match.index - 30), match.index + match[0].length + 35);
            return !/(?:^|\s)(?:от|до|около|примерно|порядка|ориентировочно|более|менее)\s*$/iu.test(before)
                && !/(?:в\s+год|в\s+месяц|ежемесячно|годовой\s+объ[её]м|сколько\s+будет\s+стоить)/iu.test(around);
        });
        if (candidates.length !== 1)
            return null;
        const count = Number(candidates[0][1].replace(/[ \u00a0\u202f]/g, ''));
        if (Number.isSafeInteger(count) && count > 0 && count <= 1e7)
            return count;
        return null;
    }
    return null;
}
function inferAutomaticQuote(messages) {
    const clientText = messages.filter(message => message.sender === 'CLIENT').map(message => message.content).join('\n');
    const tariff = serviceFromClient(clientText), itemsCount = exactPartyCount(messages);
    if (!tariff || !itemsCount)
        return null;
    if (tariff === 'PRO' && itemsCount < 500)
        return null;
    // These requested services have parameters or prices outside the standard per-unit quote.
    if (/свх|таможенн|хранени|брокер|обучени|оборудован|доставк|срочн|дизайн|карточк|нкт|gs1|1с|вскрыти[ея]\s+короб.{0,50}без\s+вскрыти/iu.test(clientText))
        return null;
    return { tariff, itemsCount };
}
function publishedTariffGuide(pricing, clientText, fullOutsourcing) {
    const settings = pricing.pricingSettings;
    const format = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    const training = /обучени|курс|заняти/iu.test(clientText);
    const cards = /карточк|номенклатур|нкт|gtin/iu.test(clientText);
    const monthly = /ежемесячн|в\s+месяц|месячн.*аутсорсинг/iu.test(clientText);
    const equipment = /оборудован|принтер/iu.test(clientText);
    const marking = fullOutsourcing || /(?:оклейк|нанесени|этикет|рулон|печать|эмисси|коды\s+маркировк|data\s*matrix)/iu.test(clientText);
    const rows = [];
    if (marking) {
        const inferred = serviceFromClient(clientText);
        const selected = fullOutsourcing ? ['STANDARD', 'PRO'] : inferred ? [inferred] : ['DIGITAL', 'PRINT', 'STANDARD', 'PRO'];
        rows.push(...selected.map(code => {
            const tariff = pricing.tariffs.find(item => item.code === code);
            return `${calculation_1.tariffNames[code]}: первые ${format(settings.volumeTier1)} ед. — ${format(tariff.priceRetail)} ₸/ед.; следующие до ${format(settings.volumeTier2)} ед. — ${format(tariff.priceWholesale)} ₸/ед.; сверх ${format(settings.volumeTier2)} ед. — ${format(tariff.priceLargeWholesale)} ₸/ед.${code === 'PRO' ? ' Минимальная партия — 500 ед.' : ''}`;
        }));
        rows.push('Ставки каждой ступени применяются только к единицам внутри неё.');
    }
    if (fullOutsourcing)
        rows.push(`Разовый аутсорсинг по заявке — от ${format(settings.outsourcingOneTimePrice)} ₸; точный состав и стоимость согласуются отдельно. Это отдельный формат услуги, его цена не прибавлена к ставкам за единицу.`);
    if (monthly && settings.outsourcingTier1Price !== undefined) {
        const tiers = [[5000, settings.outsourcingTier1Price], [10000, settings.outsourcingTier2Price], [50000, settings.outsourcingTier3Price], [100000, settings.outsourcingTier4Price]];
        rows.push('Ежемесячный аутсорсинг: ' + tiers.flatMap(([count, price]) => price === undefined ? [] : [`до ${format(count)} кодов/мес. — ${format(price)} ₸/мес.`]).join('; ') + '. Условия и состав работ согласуются отдельно.');
    }
    if (cards)
        rows.push(`Карточки товаров: НКТ — ${format(settings.cardNktPrice)} ₸/карточку; ИС МПТ — ${format(settings.cardMptPrice)} ₸/карточку; полный пакет — ${format(settings.cardFullPackagePrice)} ₸/карточку. Количество и вид карточек уточняются.`);
    if (training && settings.trainingCoursePrice !== undefined)
        rows.push(`Обучение обязательной маркировке — ${format(settings.trainingCoursePrice)} ₸ за курс; оборудование в эту цену не включено.`);
    if (equipment)
        rows.push('Стоимость оборудования определяется отдельно по выбранной модели и комплектации.');
    if (!rows.length && /(?:маркировк|товар|парт)/iu.test(clientText))
        return publishedTariffGuide(pricing, clientText + ' коды маркировки', false);
    if (!rows.length)
        return '';
    return 'Опубликованные цены TANBOX\n' + rows.join('\n') + '\nИтоговая сумма зависит от согласованного объёма и состава работ.';
}

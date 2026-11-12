"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedKnowledge = seedKnowledge;
const db_1 = require("./config/db");
async function seedKnowledge() {
    console.log("Обновление начальных правил без удаления данных");
    // Initial draft guidance. Prices and legal claims require reviewed sources.
    const defaults = {
        data: [
            {
                category: 'TARIFFS',
                title: 'Тариф «Цифровой» (DataMatrix в ИС МПТ)',
                content: 'Помощь с получением кодов и файлами для самостоятельной печати. Стоимость рассчитывается по действующему прайсу и объёму работ; платёж оператору учитывается отдельно.'
            },
            {
                category: 'TARIFFS',
                title: 'Тариф «Печать на термоэтикетках»',
                content: 'Подготовка и печать рулонов этикеток. Материал, размер, намотка, объём и доставка согласуются для конкретного заказа.'
            },
            {
                category: 'TARIFFS',
                title: 'Тариф «Стикеровка под ключ на складе»',
                content: 'Нанесение этикеток и, при необходимости, агрегация. Место работ, допустимая процедура и состав отчётности проверяются под товарную группу и партию.'
            },
            {
                category: 'OBJECTIONS',
                title: 'Отработка возражения: «Дорого, у других дешевле»',
                content: 'Сравните одинаковый состав работ: подготовку данных, получение кодов, печать, нанесение, проверку и доставку. Предложите клиенту нужный объём услуги без неподтверждённых гарантий или санкций.'
            },
            {
                category: 'OBJECTIONS',
                title: 'Отработка возражения: «Мы сами через ИС МПТ сделаем»',
                content: 'Клиент может выполнять операции самостоятельно. Уточните, на каком этапе нужна помощь. Сроки модерации и решения внешних систем нельзя гарантировать от имени TANBOX.'
            }
        ]
    };
    for (const item of defaults.data) {
        const existing = await db_1.prisma.knowledgeItem.findFirst({ where: { title: item.title, category: item.category } });
        if (!existing)
            await db_1.prisma.knowledgeItem.create({ data: item });
    }
    console.log("Начальные правила добавлены; существующие записи сохранены");
}
if (require.main === module)
    seedKnowledge()
        .catch((e) => {
        console.error('Ошибка добавления начальных правил:', e);
        process.exit(1);
    })
        .finally(async () => {
        await db_1.prisma.$disconnect();
    });

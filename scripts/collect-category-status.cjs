const path = require('node:path');
require('../backend/node_modules/dotenv').config({path: path.join(__dirname, '../backend/.env'), override: true});
const {prisma} = require('../backend/dist/config/db');
const {webSeeds} = require('../backend/dist/knowledge/web.registry');
const {captureWeb} = require('../backend/dist/knowledge/web.fetch');
const {saveWebCapture} = require('../backend/dist/knowledge/web.service');
const paths = [
  '/press/news/details/469744',
  '/press/news/details/1289664',
  '/press/news/details/1028898',
  '/business/product/furs',
  '/business/product/bytovaya-himiya.html',
];
(async () => {
  for (const seed of webSeeds.filter(s => paths.some(p => new URL(s.url).pathname.endsWith(p)))) {
    try {
      const capture = await captureWeb(seed.url);
      const saved = await saveWebCapture(seed, capture);
      console.log(JSON.stringify({url: seed.url, quality: saved.quality, characters: saved.characters, originalBytes: capture.data.length}));
    } catch (error) {
      console.log(JSON.stringify({url: seed.url, error: error.message}));
      process.exitCode = 1;
    }
  }
  const attachments = await prisma.webKnowledgeSource.findMany({where: {status: 'PENDING', discoveredFrom: 'https://tanba.telecom.kz/ru/business/product/bytovaya-himiya.html'}});
  for (const source of attachments) {
    const seed = {url: source.url, title: source.title, authority: source.authority, language: source.language, categoryCodes: source.categoryCodes, topics: source.topics, depth: source.depth, priority: source.priority, intervalHours: source.intervalHours, discoveredFrom: source.discoveredFrom};
    try {
      const capture = await captureWeb(source.url);
      const saved = await saveWebCapture(seed, capture);
      console.log(JSON.stringify({url: source.url, quality: saved.quality, characters: saved.characters, originalBytes: capture.data.length}));
    } catch (error) {
      console.log(JSON.stringify({url: source.url, error: error.message}));
      process.exitCode = 1;
    }
  }
})().finally(() => prisma.$disconnect());

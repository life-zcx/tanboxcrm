// Read-only inventory of the separate TANBOX project. No database credentials
// or customer records are read; only public content and the public tariff API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('../backend/node_modules/typescript');
const sourceRoot = path.resolve(process.argv[2] || path.join(__dirname, '../../tanbox'));
const dataRoot = path.join(sourceRoot, 'frontend-landing/src/data');
const cache = new Map();

function loadData(file) {
  const filename = path.resolve(file);
  if (!filename.startsWith(dataRoot + path.sep) || !filename.endsWith('.ts')) throw new Error('Unexpected data import');
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = name => {
    if (!name.startsWith('.')) throw new Error('Unexpected external import');
    return loadData(path.resolve(path.dirname(filename), name + '.ts'));
  };
  new Function('exports', 'require', 'module', code)(module.exports, localRequire, module);
  return module.exports;
}

async function main() {
  const categories = loadData(path.join(dataRoot, 'categoriesData.ts')).CATEGORIES_DATA;
  const articleModule = loadData(path.join(dataRoot, 'articlesData.ts'));
  const articles = articleModule.ARTICLES_DATA.map(article => articleModule.getLocalizedArticle(article, 'ru'));
  const publicPricingModule = loadData(path.join(dataRoot, 'publicPricing.ts'));
  let publicPricing = null, publicPricingError = null;
  try {
    const response = await fetch('https://tanbox.kz/api/tariffs', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const normalized = publicPricingModule.normalizePublicPricing(await response.json());
    // Explicit allowlist: exclude database identifiers and any future admin fields.
    publicPricing = {
      tariffs: normalized.tariffs.map(t => ({ code: t.code, priceRetail: t.priceRetail,
        priceWholesale: t.priceWholesale, priceLargeWholesale: t.priceLargeWholesale })),
      settings: normalized.pricingSettings,
    };
  } catch (error) { publicPricingError = error.message; }
  const files = [
    'frontend-landing/src/data/categoriesData.ts',
    'frontend-landing/src/data/categoriesLocalization.ts',
    'frontend-landing/src/data/articlesData.ts',
    'frontend-landing/src/data/articlesLocalization.ts',
    'frontend-landing/src/data/articleRevisions.ts',
    'frontend-landing/src/data/publicPricing.ts',
    'frontend-landing/src/hooks/useCalculator.ts',
    'frontend-landing/src/context/PublicPricingContext.tsx',
    'frontend-landing/src/pages/ServicesPage.tsx',
    'backend/src/utils/pricing.ts',
    'backend/src/controllers/tariffs.controller.ts',
    'backend/prisma/seed.ts',
  ];
  const inventory = {
    capturedAt: new Date().toISOString(), sourceRoot, jurisdiction: 'KZ',
    status: 'RESEARCH_ONLY_NOT_PUBLISHED',
    warning: 'Source website content is not verified legislation. Resolve conflicting claims before publishing CRM answers.',
    files: files.map(file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, file))).digest('hex') })),
    categories: categories.map(c => ({ id: c.id, title: c.title, sourceStatus: c.status,
      sourceDate: c.dateFull, tnvedHint: c.tnved, stages: c.stages || [],
      workflow: c.processSteps, faq: c.faq })),
    articles: articles.map(a => ({ slug: a.slug, title: a.title, category: a.category,
      updatedAt: a.updatedAt || null, targetCategoryCode: a.targetCategoryCode || null,
      sections: a.contentSections.map(s => ({ id: s.id, title: s.title })), faqCount: a.faq.length })),
    publicPricing: { url: 'https://tanbox.kz/api/tariffs', data: publicPricing, error: publicPricingError },
    conflicts: [
      { topic: 'water', reason: 'Raw category claims mandatory marking from 2024-07-01; articleRevisions explicitly rejects that claim for ordinary water under 2201.' },
      { topic: 'pricing', reason: 'Legacy backend seed and CRM hardcoded tariffs differ from active public pricing. Import public runtime settings, not seed defaults.' },
      { topic: 'customs', reason: 'Textile FAQ rejects ordinary temporary storage for marking; jewelry FAQ treats temporary storage as a customs warehouse. Customs procedure must be checked separately.' },
      { topic: 'regulatory status', reason: 'Static UPCOMING labels for beer, oils and supplements do not encode separate implementation phases or the date of the answer.' },
      { topic: 'operator fees', reason: 'Calculator contains a fixed operator fee and old tax comment; this is not evidence of a current universal tariff across product groups.' },
    ],
  };
  const target = path.join(__dirname, '../docs/knowledge/source-inventory.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(inventory, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ file: path.relative(path.join(__dirname, '..'), target),
    categories: categories.length, articles: articles.length,
    publicPricingLoaded: Boolean(publicPricing), conflicts: inventory.conflicts.length }));
  if (publicPricingError) console.warn('Public pricing unavailable: ' + publicPricingError);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

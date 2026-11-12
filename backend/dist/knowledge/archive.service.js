"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = exports.activeImportKey = void 0;
exports.canonical = canonical;
exports.documentDigest = documentDigest;
exports.splitPassages = splitPassages;
exports.validateBundle = validateBundle;
exports.verifyArchive = verifyArchive;
exports.importArchive = importArchive;
exports.activeArchive = activeArchive;
exports.archiveDocument = archiveDocument;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const errors_1 = require("../lib/errors");
exports.activeImportKey = 'knowledge.activeImport';
function canonical(value) {
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
const sha256 = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
exports.sha256 = sha256;
function documentDigest(d) {
    return (0, exports.sha256)(canonical({ key: d.key, kind: d.kind, language: d.language, title: d.title, categoryCodes: d.categoryCodes,
        content: d.content, payload: d.payload, sourcePaths: d.sourcePaths, reviewStatus: d.reviewStatus, issues: d.issues }));
}
function splitPassages(content, maxLength = 2400) {
    const result = [];
    for (let start = 0; start < content.length;) {
        let end = Math.min(start + maxLength, content.length);
        if (end < content.length) {
            const newline = content.lastIndexOf('\n', end - 1);
            if (newline > start + maxLength / 2)
                end = newline + 1;
            if (end > start && /[\uD800-\uDBFF]/.test(content[end - 1]))
                end--;
        }
        result.push(content.slice(start, end));
        start = end;
    }
    return result;
}
const hash = zod_1.z.string().regex(/^[a-f0-9]{64}$/);
const documentSchema = zod_1.z.object({
    key: zod_1.z.string().min(1), kind: zod_1.z.string().min(1), language: zod_1.z.string().min(1), title: zod_1.z.string().min(1),
    categoryCodes: zod_1.z.array(zod_1.z.string()), content: zod_1.z.string().min(1), payload: zod_1.z.json(), sha256: hash,
    sourcePaths: zod_1.z.array(zod_1.z.string()).min(1), reviewStatus: zod_1.z.literal('SOURCE'), issues: zod_1.z.array(zod_1.z.string()),
}).strict();
const bundleSchema = zod_1.z.object({
    format: zod_1.z.literal(1), bundleHash: hash, capturedAt: zod_1.z.iso.datetime(), sourceRoot: zod_1.z.string(),
    manifest: zod_1.z.object({ scope: zod_1.z.string(), categories: zod_1.z.array(zod_1.z.object({ code: zod_1.z.string(), title: zod_1.z.string(), aliases: zod_1.z.array(zod_1.z.string()) })),
        coverage: zod_1.z.object({ categories: zod_1.z.number().int(), articles: zod_1.z.number().int(), sourceFiles: zod_1.z.number().int(), sourceBytes: zod_1.z.number().int(), documents: zod_1.z.number().int(), contentCharacters: zod_1.z.number().int() }).passthrough(), excluded: zod_1.z.array(zod_1.z.string()) }),
    sources: zod_1.z.array(zod_1.z.object({ path: zod_1.z.string().min(1), sha256: hash, byteLength: zod_1.z.number().int().nonnegative(), data: zod_1.z.string() }).strict()),
    documents: zod_1.z.array(documentSchema),
}).strict();
function validateBundle(input) {
    const bundle = bundleSchema.parse(input), paths = new Set(bundle.sources.map(s => s.path)), keys = new Set(bundle.documents.map(d => d.key));
    const coverage = bundle.manifest.coverage;
    if (paths.size !== bundle.sources.length || keys.size !== bundle.documents.length)
        throw new Error('Duplicate source or document');
    if (coverage.sourceFiles !== paths.size || coverage.documents !== keys.size || coverage.categories !== bundle.manifest.categories.length)
        throw new Error('Incomplete manifest');
    if (new Set(bundle.manifest.categories.map(c => c.code)).size !== coverage.categories)
        throw new Error('Duplicate category');
    for (const source of bundle.sources) {
        const data = Buffer.from(source.data, 'base64');
        if (data.length !== source.byteLength || (0, exports.sha256)(data) !== source.sha256)
            throw new Error('Source checksum mismatch: ' + source.path);
    }
    for (const doc of bundle.documents) {
        if (documentDigest(doc) !== doc.sha256)
            throw new Error('Document checksum mismatch: ' + doc.key);
        if (doc.sourcePaths.some(p => !paths.has(p)))
            throw new Error('Missing document source: ' + doc.key);
    }
    if (coverage.sourceBytes !== bundle.sources.reduce((n, s) => n + s.byteLength, 0) || coverage.contentCharacters !== bundle.documents.reduce((n, d) => n + d.content.length, 0))
        throw new Error('Coverage mismatch');
    const expected = (0, exports.sha256)(canonical({ sources: bundle.sources.map(s => ({ path: s.path, sha256: s.sha256 })), documents: bundle.documents.map(d => ({ key: d.key, sha256: d.sha256 })), manifest: bundle.manifest }));
    if (expected !== bundle.bundleHash)
        throw new Error('Bundle checksum mismatch');
    for (const c of bundle.manifest.categories)
        for (const language of ['ru', 'kz', 'en']) {
            if (!bundle.documents.some(d => d.kind === 'CATEGORY' && d.language === language && d.categoryCodes.includes(c.code)))
                throw new Error('Missing category language: ' + c.code + ':' + language);
        }
    for (const language of ['ru', 'kz', 'en'])
        if (bundle.documents.filter(d => d.kind === 'ARTICLE' && d.language === language).length !== coverage.articles)
            throw new Error('Missing article language: ' + language);
    if (bundle.documents.filter(d => d.kind === 'ORIGINAL').length !== coverage.articles)
        throw new Error('Missing original article');
    return bundle;
}
async function verifyArchive(importId) {
    const batch = await db_1.prisma.knowledgeImport.findUniqueOrThrow({ where: { id: importId }, include: { sources: true, documents: { include: { passages: { orderBy: { position: 'asc' } } } } } });
    const sources = batch.sources.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const manifest = batch.manifest, coverage = manifest.coverage;
    const failures = [];
    for (const s of sources)
        if (s.data.length !== s.byteLength || (0, exports.sha256)(s.data) !== s.sha256)
            failures.push('source:' + s.path);
    let passages = 0;
    for (const d of batch.documents) {
        passages += d.passages.length;
        if (documentDigest(d) !== d.sha256)
            failures.push('document:' + d.key);
        if (d.passages.map(p => p.content).join('') !== d.content || d.passages.some((p, i) => p.position !== i))
            failures.push('passages:' + d.key);
        if (d.sourcePaths.some(p => !sources.some(s => s.path === p)))
            failures.push('references:' + d.key);
    }
    if (sources.length !== coverage.sourceFiles || batch.documents.length !== coverage.documents || sources.reduce((n, s) => n + s.byteLength, 0) !== coverage.sourceBytes || batch.documents.reduce((n, d) => n + d.content.length, 0) !== coverage.contentCharacters)
        failures.push('counts');
    // Original ordering is in the manifest, independent of PostgreSQL row order.
    const orderedSources = manifest.sourceOrder.map(p => sources.find(s => s.path === p));
    const orderedDocs = manifest.documentOrder.map(k => batch.documents.find(d => d.key === k));
    if (orderedSources.some(s => !s) || orderedDocs.some(d => !d))
        failures.push('order');
    else {
        const { sourceOrder, documentOrder, ...originalManifest } = manifest;
        const reconstructed = (0, exports.sha256)(canonical({ sources: orderedSources.map(s => ({ path: s.path, sha256: s.sha256 })), documents: orderedDocs.map(d => ({ key: d.key, sha256: d.sha256 })), manifest: originalManifest }));
        if (reconstructed !== batch.bundleHash)
            failures.push('bundle');
    }
    for (const c of manifest.categories)
        for (const lang of ['ru', 'kz', 'en'])
            if (!batch.documents.some(d => d.kind === 'CATEGORY' && d.language === lang && d.categoryCodes.includes(c.code)))
                failures.push('category:' + c.code + ':' + lang);
    return { importId, bundleHash: batch.bundleHash, ok: failures.length === 0, failures, sourceFiles: sources.length, sourceBytes: sources.reduce((n, s) => n + s.byteLength, 0), documents: batch.documents.length, passages, contentCharacters: batch.documents.reduce((n, d) => n + d.content.length, 0), categories: manifest.categories.length, checkedAt: new Date().toISOString() };
}
async function importArchive(input) {
    const bundle = validateBundle(input);
    let batch = await db_1.prisma.knowledgeImport.findUnique({ where: { bundleHash: bundle.bundleHash } });
    if (!batch) {
        batch = await db_1.prisma.$transaction(async (tx) => {
            const created = await tx.knowledgeImport.create({ data: { bundleHash: bundle.bundleHash, sourceRoot: bundle.sourceRoot, capturedAt: new Date(bundle.capturedAt), manifest: { ...bundle.manifest, sourceOrder: bundle.sources.map(s => s.path), documentOrder: bundle.documents.map(d => d.key) } } });
            for (const source of bundle.sources)
                await tx.knowledgeSource.create({ data: { importId: created.id, path: source.path, sha256: source.sha256, byteLength: source.byteLength, data: Buffer.from(source.data, 'base64') } });
            for (const doc of bundle.documents) {
                const saved = await tx.knowledgeDocument.create({ data: { ...doc, payload: doc.payload, importId: created.id } });
                await tx.knowledgePassage.createMany({ data: splitPassages(doc.content).map((content, position) => ({ documentId: saved.id, position, content })) });
            }
            return created;
        }, { maxWait: 10000, timeout: 120000 });
    }
    const report = await verifyArchive(batch.id);
    if (!report.ok)
        throw new Error('Stored knowledge archive did not pass integrity verification: ' + report.failures.join(','));
    await db_1.prisma.$transaction([
        db_1.prisma.knowledgeImport.update({ where: { id: batch.id }, data: { verifiedAt: new Date() } }),
        db_1.prisma.systemSetting.upsert({ where: { key: exports.activeImportKey }, create: { key: exports.activeImportKey, value: batch.id, description: 'Verified complete source import for the knowledge library' }, update: { value: batch.id } }),
    ]);
    return report;
}
async function activeArchive() {
    const setting = await db_1.prisma.systemSetting.findUnique({ where: { key: exports.activeImportKey } });
    return setting ? db_1.prisma.knowledgeImport.findFirst({ where: { id: setting.value, verifiedAt: { not: null } } }) : null;
}
async function archiveDocument(id) {
    const document = await db_1.prisma.knowledgeDocument.findUnique({ where: { id }, include: { import: { select: { capturedAt: true, bundleHash: true, verifiedAt: true } } } });
    if (!document || !document.import.verifiedAt)
        throw new errors_1.AppError(404, 'Материал не найден');
    const sources = await db_1.prisma.knowledgeSource.findMany({ where: { importId: document.importId, path: { in: document.sourcePaths } }, select: { id: true, path: true, sha256: true, byteLength: true } });
    return { ...document, sources };
}

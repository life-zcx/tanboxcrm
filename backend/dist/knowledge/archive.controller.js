"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportLibrary = exports.verifyLibrary = exports.downloadLibrarySource = exports.getLibraryDocument = exports.listLibrary = void 0;
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const db_1 = require("../config/db");
const errors_1 = require("../lib/errors");
const validation_1 = require("../lib/validation");
const archive_service_1 = require("./archive.service");
exports.listLibrary = (0, errors_1.route)(async (req, res) => {
    const query = zod_1.z.object({ category: zod_1.z.string().regex(/^[a-zA-Z_]+$/).optional(), language: zod_1.z.enum(['ru', 'kz', 'en', 'mixed', 'ALL']).default('ru'), search: zod_1.z.string().trim().max(200).default(''), kind: zod_1.z.string().regex(/^[A-Z_]+$/).optional(), importId: validation_1.idSchema.optional(), limit: zod_1.z.unknown().optional(), offset: zod_1.z.unknown().optional() }).strict().parse(req.query);
    const batch = query.importId ? await db_1.prisma.knowledgeImport.findFirst({ where: { id: query.importId, verifiedAt: { not: null } } }) : await (0, archive_service_1.activeArchive)();
    const versions = await db_1.prisma.knowledgeImport.findMany({ where: { verifiedAt: { not: null } }, orderBy: { createdAt: 'desc' }, select: { id: true, capturedAt: true, bundleHash: true, verifiedAt: true } });
    if (!batch) {
        res.json({ archive: null, documents: [], sources: [], versions, total: 0 });
        return;
    }
    const { skip, take } = (0, validation_1.pagination)(req.query, 20);
    const where = { importId: batch.id, ...(query.category ? { categoryCodes: { has: query.category } } : {}), ...(query.language === 'ALL' ? {} : { language: query.language }), ...(query.kind ? { kind: query.kind } : {}), ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { content: { contains: query.search, mode: 'insensitive' } }] } : {}) };
    const [documents, total, sources] = await db_1.prisma.$transaction([
        db_1.prisma.knowledgeDocument.findMany({ where, skip, take, orderBy: [{ kind: 'asc' }, { title: 'asc' }, { id: 'asc' }], select: { id: true, title: true, kind: true, language: true, categoryCodes: true, reviewStatus: true, issues: true, _count: { select: { passages: true } } } }),
        db_1.prisma.knowledgeDocument.count({ where }),
        db_1.prisma.knowledgeSource.findMany({ where: { importId: batch.id }, orderBy: { path: 'asc' }, select: { id: true, path: true, sha256: true, byteLength: true } }),
    ]);
    res.json({ archive: { id: batch.id, capturedAt: batch.capturedAt, bundleHash: batch.bundleHash, verifiedAt: batch.verifiedAt, manifest: batch.manifest }, documents, sources, versions, total, offset: skip, limit: take });
});
exports.getLibraryDocument = (0, errors_1.route)(async (req, res) => res.json({ document: await (0, archive_service_1.archiveDocument)(validation_1.idSchema.parse(req.params.id)) }));
exports.downloadLibrarySource = (0, errors_1.route)(async (req, res) => {
    const source = await db_1.prisma.knowledgeSource.findUnique({ where: { id: validation_1.idSchema.parse(req.params.id) }, include: { import: { select: { verifiedAt: true } } } });
    if (!source || !source.import.verifiedAt)
        throw new errors_1.AppError(404, 'Исходник не найден');
    if (source.data.length !== source.byteLength || (0, archive_service_1.sha256)(source.data) !== source.sha256)
        throw new errors_1.AppError(409, 'Контрольная сумма исходника не совпадает');
    const filename = node_path_1.default.posix.basename(source.path.replaceAll('\\', '/'));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', "attachment; filename=source.txt; filename*=UTF-8''" + encodeURIComponent(filename));
    res.setHeader('X-Content-SHA256', source.sha256);
    res.send(source.data);
});
exports.verifyLibrary = (0, errors_1.route)(async (req, res) => {
    const id = req.query.importId ? validation_1.idSchema.parse(req.query.importId) : (await (0, archive_service_1.activeArchive)())?.id;
    if (!id)
        throw new errors_1.AppError(404, 'База ещё не импортирована');
    const exists = await db_1.prisma.knowledgeImport.findUnique({ where: { id } });
    if (!exists)
        throw new errors_1.AppError(404, 'Версия не найдена');
    res.json(await (0, archive_service_1.verifyArchive)(id));
});
exports.exportLibrary = (0, errors_1.route)(async (req, res) => {
    const id = req.query.importId ? validation_1.idSchema.parse(req.query.importId) : (await (0, archive_service_1.activeArchive)())?.id;
    if (!id)
        throw new errors_1.AppError(404, 'База ещё не импортирована');
    const batch = await db_1.prisma.knowledgeImport.findFirst({ where: { id, verifiedAt: { not: null } }, include: { sources: true, documents: true } });
    if (!batch)
        throw new errors_1.AppError(404, 'Версия не найдена');
    const report = await (0, archive_service_1.verifyArchive)(id);
    if (!report.ok)
        throw new errors_1.AppError(409, 'Проверка целостности не пройдена');
    const { sourceOrder, documentOrder, ...manifest } = batch.manifest;
    const bundle = { format: 1, bundleHash: batch.bundleHash, sourceRoot: batch.sourceRoot, capturedAt: batch.capturedAt.toISOString(), manifest,
        sources: sourceOrder.map((p) => { const s = batch.sources.find(s => s.path === p); return { path: s.path, sha256: s.sha256, byteLength: s.byteLength, data: s.data.toString('base64') }; }),
        documents: documentOrder.map((key) => { const d = batch.documents.find(d => d.key === key); return { key: d.key, kind: d.kind, language: d.language, title: d.title, categoryCodes: d.categoryCodes, content: d.content, payload: d.payload, sha256: d.sha256, sourcePaths: d.sourcePaths, reviewStatus: d.reviewStatus, issues: d.issues }; }) };
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment; filename=tanbox-knowledge-' + batch.bundleHash.slice(0, 12) + '.json');
    res.json(bundle);
});

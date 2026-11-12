"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerWebCollection = exports.getMarkingListLookup = exports.getWebSearch = exports.getWebRaw = exports.getWebDocument = exports.getWebOverview = void 0;
const zod_1 = require("zod");
const db_1 = require("../config/db");
const errors_1 = require("../lib/errors");
const validation_1 = require("../lib/validation");
const archive_service_1 = require("./archive.service");
const web_service_1 = require("./web.service");
const web_retrieval_1 = require("./web.retrieval");
const web_list_1 = require("./web.list");
exports.getWebOverview = (0, errors_1.route)(async (_req, res) => res.json(await (0, web_service_1.webOverview)()));
exports.getWebDocument = (0, errors_1.route)(async (req, res) => {
    const revision = await db_1.prisma.webKnowledgeRevision.findUnique({ where: { id: validation_1.idSchema.parse(req.params.id) }, include: { source: true, _count: { select: { passages: true } } } });
    if (!revision)
        throw new errors_1.AppError(404, 'Документ не найден');
    const { data, ...document } = revision;
    res.json({ document, integrity: (0, archive_service_1.sha256)(data) === revision.sha256 && (0, web_service_1.semanticHash)(revision.text) === revision.contentHash });
});
exports.getWebRaw = (0, errors_1.route)(async (req, res) => {
    const revision = await db_1.prisma.webKnowledgeRevision.findUnique({ where: { id: validation_1.idSchema.parse(req.params.id) } });
    if (!revision)
        throw new errors_1.AppError(404, 'Документ не найден');
    if ((0, archive_service_1.sha256)(revision.data) !== revision.sha256)
        throw new errors_1.AppError(409, 'Контрольная сумма не совпадает');
    const ext = revision.data.subarray(0, 5).toString() === '%PDF-' ? 'pdf' : revision.contentType.includes('word') ? 'docx' : revision.contentType.includes('json') ? 'json' : 'bin';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename=knowledge-' + revision.sha256.slice(0, 12) + '.' + ext);
    res.send(revision.data);
});
exports.getWebSearch = (0, errors_1.route)(async (req, res) => {
    const { search, category } = zod_1.z.object({ search: zod_1.z.string().trim().min(2).max(500), category: zod_1.z.string().regex(/^[a-zA-Z_]+$/).optional() }).strict().parse(req.query);
    const [passages, knowledge] = await Promise.all([(0, web_retrieval_1.searchWebPassages)(search, category), (0, web_retrieval_1.knowledgeForReply)({ query: search, category })]);
    res.json({ passages, evidence: knowledge.evidence, category: knowledge.category, topic: knowledge.topic });
});
exports.getMarkingListLookup = (0, errors_1.route)(async (req, res) => {
    const { code } = zod_1.z.object({ code: zod_1.z.string().trim().min(4).max(20) }).strict().parse(req.query);
    res.json(await (0, web_list_1.lookupMarkingList)(code));
});
exports.triggerWebCollection = (0, errors_1.route)(async (_req, res) => {
    // Source URLs come only from the controlled registry, never from this request.
    void (0, web_service_1.collectDue)(10).catch(() => console.warn('Knowledge collection deferred'));
    res.status(202).json({ queued: true });
});

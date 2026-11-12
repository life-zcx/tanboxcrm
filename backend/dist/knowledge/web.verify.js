"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWebCorpus = verifyWebCorpus;
const db_1 = require("../config/db");
async function verifyWebCorpus() {
    // Hash originals in PostgreSQL to avoid moving hundreds of megabytes through
    // the application process just to check integrity.
    const [bytes] = await db_1.prisma.$queryRaw `
    SELECT COUNT(*)::int AS revisions,COUNT(DISTINCT "sha256")::int AS "distinctOriginals",
      COALESCE(SUM(octet_length(data)),0)::float8 AS bytes,
      COUNT(*) FILTER (WHERE encode(sha256(data),'hex')<>"sha256")::int AS "badOriginals"
    FROM "WebKnowledgeRevision"
  `;
    const [text] = await db_1.prisma.$queryRaw `
    WITH pieces AS (
      SELECT "revisionId",string_agg(content,'' ORDER BY position) AS combined,
        COUNT(*) AS count,MIN(position) AS first,MAX(position) AS last
      FROM "WebKnowledgePassage" GROUP BY "revisionId"
    ) SELECT COUNT(*) FILTER (WHERE COALESCE(p.combined,'')<>r.text OR p.count>0 AND (p.first<>0 OR p.last+1<>p.count))::int AS "badPassages",
      COALESCE(SUM(p.count),0)::int AS passages
    FROM "WebKnowledgeRevision" r LEFT JOIN pieces p ON p."revisionId"=r.id
  `;
    const statuses = await db_1.prisma.webKnowledgeSource.groupBy({ by: ['status'], _count: true });
    return { ...bytes, ...text, statuses, ok: bytes.badOriginals === 0 && text.badPassages === 0, checkedAt: new Date().toISOString() };
}
if (require.main === module)
    verifyWebCorpus().then(report => { console.log(JSON.stringify(report, null, 2)); if (!report.ok)
        process.exitCode = 1; }).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db_1.prisma.$disconnect());

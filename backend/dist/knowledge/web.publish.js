"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const db_1 = require("../config/db");
const web_service_1 = require("./web.service");
async function main() {
    const input = JSON.parse(await promises_1.default.readFile(process.argv[2] || 'data/web-reviewed-facts.json', 'utf8'));
    let published = 0;
    const skipped = [];
    for (const fact of input.facts) {
        const evidence = [];
        let valid = true;
        for (const e of fact.evidence) {
            const source = await db_1.prisma.webKnowledgeSource.findUnique({ where: { url: e.url } });
            const revision = source?.currentRevisionId ? await db_1.prisma.webKnowledgeRevision.findUnique({ where: { id: source.currentRevisionId } }) : null;
            if (!revision || revision.contentHash !== e.expectedContentHash) {
                valid = false;
                break;
            }
            evidence.push({ revisionId: revision.id, quote: e.quote, locator: e.locator });
        }
        if (!valid) {
            skipped.push(fact.key);
            continue;
        }
        const { evidence: _, ...fields } = fact;
        await (0, web_service_1.publishFact)({ ...fields, evidence, reviewedBy: input.reviewedBy, reviewDueAt: new Date(new Date(input.reviewedAt + 'T00:00:00+05:00').getTime() + 14 * 86400000) });
        published++;
    }
    console.log(JSON.stringify({ published, skipped }));
}
if (require.main === module)
    main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db_1.prisma.$disconnect());

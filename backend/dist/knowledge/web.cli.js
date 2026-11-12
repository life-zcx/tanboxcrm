"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const db_1 = require("../config/db");
const web_service_1 = require("./web.service");
const web_fetch_1 = require("./web.fetch");
async function* snapshotLines(filename) {
    const input = node_fs_1.default.createReadStream(filename, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    let pending = '';
    for await (const chunk of input) {
        pending += chunk;
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            if (line.trim())
                yield line;
        }
    }
    if (pending.trim())
        yield pending;
}
async function main() {
    await (0, web_service_1.seedWebRegistry)();
    if (process.argv[2] === '--import') {
        let ready = 0, attention = 0, processed = 0;
        // Stream originals instead of loading a potentially large corpus into RAM.
        // Resumed outcomes are chronological; the final record remains current.
        const seen = new Set();
        for await (const line of snapshotLines(process.argv[3] || 'data/web-captures.ndjson')) {
            if (!line.trim())
                continue;
            const item = JSON.parse(line);
            seen.add(item.seed.url);
            if (item.capture) {
                const result = await (0, web_service_1.saveWebCapture)(item.seed, { ...item.capture, data: Buffer.from(item.capture.data, 'base64') }, new Date(item.capturedAt));
                if (result.quality === 'FULLTEXT')
                    ready++;
                else
                    attention++;
            }
            else {
                await (0, web_service_1.recordWebFailure)(item.seed, item.error, new Date(item.capturedAt));
                attention++;
            }
            processed++;
            if (processed % 20 === 0)
                console.log(JSON.stringify({ processed, ready, attention, rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024) }));
        }
        console.log(JSON.stringify({ sources: seen.size, ready, attention }));
    }
    else if (process.argv[2] === '--ocr') {
        const sources = await db_1.prisma.webKnowledgeSource.findMany({ where: { status: 'NEEDS_OCR' }, orderBy: { lastAttemptAt: 'asc' }, take: Number(process.argv[3] || 10) });
        for (const source of sources) {
            if (!source.currentRevisionId)
                continue;
            const revision = await db_1.prisma.webKnowledgeRevision.findUniqueOrThrow({ where: { id: source.currentRevisionId } });
            const capture = await (0, web_fetch_1.extractWebData)(source.url, { url: revision.finalUrl, status: 200, data: revision.data, contentType: revision.contentType });
            console.log(JSON.stringify(await (0, web_service_1.saveWebCapture)({ ...source, discoveredFrom: source.discoveredFrom || undefined }, capture)));
        }
    }
    else
        console.log(JSON.stringify(await (0, web_service_1.collectDue)(Number(process.argv[2] || 10))));
}
if (require.main === module)
    main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db_1.prisma.$disconnect());

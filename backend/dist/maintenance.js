"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenance = maintenance;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("./config/db");
const env_1 = require("./config/env");
const validation_1 = require("./lib/validation");
const files_1 = require("./lib/files");
async function maintenance() {
    let cursor, normalized = 0, deals = 0;
    while (true) {
        const page = await db_1.prisma.client.findMany({ orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, name: true, phone: true, status: true, estimatedAmount: true, estimatedVolume: true, _count: { select: { deals: true } } } });
        if (!page.length)
            break;
        for (const client of page) {
            await db_1.prisma.$transaction(async (tx) => {
                const phone = (0, validation_1.normalizePhone)(client.phone);
                if (phone && phone !== client.phone) {
                    await tx.client.update({ where: { id: client.id }, data: { phone } });
                    normalized++;
                }
                if (!client._count.deals) {
                    await tx.deal.create({ data: { clientId: client.id, title: 'Заказ: ' + client.name, stage: validation_1.statusToStage[client.status] || 'NEW', amount: client.estimatedAmount, codesCount: client.estimatedVolume } });
                    deals++;
                }
            });
        }
        cursor = page[page.length - 1].id;
    }
    let quarantined = 0;
    const references = new Set();
    let chunkCursor;
    while (true) {
        const chunks = await db_1.prisma.conversationChunk.findMany({ select: { id: true, screenshotUrl: true }, orderBy: { id: 'asc' }, take: 100, ...(chunkCursor ? { cursor: { id: chunkCursor }, skip: 1 } : {}) });
        if (!chunks.length)
            break;
        chunks.forEach(c => (c.screenshotUrl || '').split(',').forEach(u => { const name = (0, files_1.imageFilename)(u); if (name)
            references.add(name); }));
        chunkCursor = chunks[chunks.length - 1].id;
    }
    const root = node_path_1.default.resolve(env_1.env.UPLOADS_DIR), quarantine = node_path_1.default.join(root, '.quarantine');
    await promises_1.default.mkdir(quarantine, { recursive: true });
    for (const file of await promises_1.default.readdir(root, { withFileTypes: true })) {
        if (!file.isFile() || references.has(file.name))
            continue;
        const source = node_path_1.default.resolve(root, file.name);
        if (node_path_1.default.dirname(source) !== root)
            throw new Error('Unsafe maintenance path');
        const info = await promises_1.default.stat(source);
        if (Date.now() - info.mtimeMs < 3600_000)
            continue;
        await promises_1.default.rename(source, node_path_1.default.join(quarantine, Date.now() + '-' + file.name));
        quarantined++;
    }
    await db_1.prisma.authCode.deleteMany();
    await db_1.prisma.authSession.deleteMany();
    console.log(JSON.stringify({ normalizedPhones: normalized, createdMissingDeals: deals, quarantinedFiles: quarantined, sessionsRevoked: true }));
}
if (require.main === module)
    maintenance().catch(() => { console.error('Maintenance failed'); process.exitCode = 1; }).finally(() => db_1.prisma.$disconnect());

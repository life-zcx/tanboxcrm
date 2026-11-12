"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../config/db");
const archive_service_1 = require("./archive.service");
async function main() {
    if (process.argv.includes('--verify')) {
        const batch = await (0, archive_service_1.activeArchive)();
        if (!batch)
            throw new Error('No active archive');
        const report = await (0, archive_service_1.verifyArchive)(batch.id);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok)
            process.exitCode = 1;
    }
    else {
        const filename = process.argv[2] || node_path_1.default.join(process.cwd(), 'data/knowledge-bundle.json');
        console.log(JSON.stringify(await (0, archive_service_1.importArchive)(JSON.parse(await promises_1.default.readFile(filename, 'utf8'))), null, 2));
    }
}
if (require.main === module)
    main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db_1.prisma.$disconnect());

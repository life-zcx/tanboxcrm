"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ocrPdf = ocrPdf;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const execute = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function ocrPdf(data, pages, missing) {
    if (missing.length > 50)
        return null;
    try {
        await execute('tesseract', ['--version'], { timeout: 5000 });
    }
    catch {
        return null;
    }
    const directory = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'tanbox-knowledge-ocr-'));
    try {
        const filename = node_path_1.default.join(directory, 'source.pdf');
        await promises_1.default.writeFile(filename, data);
        const result = new Map(pages.map(p => [p.num, p.text]));
        for (const page of missing) {
            const prefix = node_path_1.default.join(directory, 'page-' + page);
            await execute('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-r', '160', '-png', filename, prefix], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
            const { stdout } = await execute('tesseract', [prefix + '.png', 'stdout', '-l', 'rus+kaz+eng', '--psm', '3'], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
            result.set(page, stdout);
        }
        return [...result].sort(([a], [b]) => a - b).map(([num, text]) => text + '\n\n-- ' + num + ' of ' + pages.length + ' --\n\n').join('');
    }
    finally {
        const resolved = node_path_1.default.resolve(directory);
        if (node_path_1.default.dirname(resolved) === node_path_1.default.resolve(node_os_1.default.tmpdir()) && node_path_1.default.basename(resolved).startsWith('tanbox-knowledge-ocr-'))
            await promises_1.default.rm(resolved, { recursive: true, force: true });
    }
}

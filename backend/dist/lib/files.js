"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TOTAL_BYTES = exports.MAX_FILE_BYTES = exports.MAX_FILES = void 0;
exports.prepareImages = prepareImages;
exports.imageFilename = imageFilename;
exports.deleteImages = deleteImages;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const sharp_1 = __importDefault(require("sharp"));
const env_1 = require("../config/env");
const errors_1 = require("./errors");
exports.MAX_FILES = 15, exports.MAX_FILE_BYTES = 10 * 1024 * 1024, exports.MAX_TOTAL_BYTES = 40 * 1024 * 1024;
sharp_1.default.concurrency(1);
sharp_1.default.cache({ memory: 32, files: 0, items: 20 });
async function prepareImages(inputs) {
    if (!inputs.length || inputs.length > exports.MAX_FILES || inputs.some(i => i.buffer.length > exports.MAX_FILE_BYTES) || inputs.reduce((n, i) => n + i.buffer.length, 0) > exports.MAX_TOTAL_BYTES)
        throw new errors_1.AppError(413, 'Допускается до 15 файлов: до 10 МБ каждый, до 40 МБ суммарно');
    const images = [];
    await promises_1.default.mkdir(env_1.env.UPLOADS_DIR, { recursive: true });
    try {
        for (const input of inputs) {
            const b = input.buffer;
            const magic = b.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg' : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
            if (!magic)
                throw new errors_1.AppError(415, 'Файл не является изображением PNG, JPG или WEBP');
            let buffer;
            try {
                buffer = await (0, sharp_1.default)(b, { limitInputPixels: 20_000_000, failOn: 'error', pages: 1 }).rotate().resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).timeout({ seconds: 10 }).toBuffer();
            }
            catch {
                throw new errors_1.AppError(415, 'Изображение повреждено или превышает допустимый размер');
            }
            const filename = 'screenshot-' + (0, node_crypto_1.randomUUID)() + '.jpg';
            await promises_1.default.writeFile(node_path_1.default.join(env_1.env.UPLOADS_DIR, filename), buffer, { flag: 'wx', mode: 0o600 });
            images.push({ buffer, mimeType: 'image/jpeg', url: '/uploads/' + filename });
        }
        return images;
    }
    catch (error) {
        await deleteImages(images.map(i => i.url));
        throw error;
    }
}
function imageFilename(url) {
    const filename = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : '';
    return /^screenshot-(?:[0-9]+-[0-9]+|[0-9a-f-]{36})\.(?:jpg|jpeg|png|webp)$/i.test(filename) ? filename : null;
}
async function deleteImages(urls) {
    for (const url of urls) {
        const filename = imageFilename(url);
        if (filename)
            await promises_1.default.unlink(node_path_1.default.join(env_1.env.UPLOADS_DIR, filename)).catch(e => { if (e.code !== 'ENOENT')
                console.warn('Image cleanup failed'); });
    }
}

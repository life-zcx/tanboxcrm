"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadScreenshots = void 0;
const multer_1 = __importDefault(require("multer"));
const errors_1 = require("../lib/errors");
const files_1 = require("../lib/files");
let activeUploads = 0;
const parse = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: files_1.MAX_FILE_BYTES, files: files_1.MAX_FILES, fields: 3, fieldSize: 4 * 1024 * 1024, parts: files_1.MAX_FILES + 3 },
    fileFilter: (_req, file, cb) => {
        if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
            cb(null, true);
        else
            cb(new errors_1.AppError(415, 'Разрешены только PNG, JPG и WEBP'));
    },
}).array('screenshots', files_1.MAX_FILES);
const uploadScreenshots = (req, res, next) => {
    if (activeUploads >= 2) {
        next(new errors_1.AppError(429, 'Обработка других изображений ещё не завершена. Повторите позже.'));
        return;
    }
    if (Number(req.headers['content-length'] || 0) > files_1.MAX_TOTAL_BYTES) {
        next(new errors_1.AppError(413, 'Общий размер загрузки не должен превышать 40 МБ'));
        return;
    }
    activeUploads++;
    let released = false, received = 0;
    const release = () => { if (!released) {
        released = true;
        activeUploads--;
    } };
    res.once('finish', release);
    res.once('close', release);
    req.on('data', chunk => { received += chunk.length; if (received > files_1.MAX_TOTAL_BYTES)
        req.destroy(); });
    parse(req, res, next);
};
exports.uploadScreenshots = uploadScreenshots;

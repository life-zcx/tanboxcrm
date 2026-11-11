import multer from 'multer';
import { RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from '../lib/files';
let activeUploads = 0;
const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 3, fieldSize: 4 * 1024 * 1024, parts: MAX_FILES + 3 },
  fileFilter: (_req, file, cb) => {
    if (['image/png','image/jpeg','image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new AppError(415, 'Разрешены только PNG, JPG и WEBP'));
  },
}).array('screenshots', MAX_FILES);
export const uploadScreenshots: RequestHandler = (req, res, next) => {
  if (activeUploads >= 2) { next(new AppError(429, 'Обработка других изображений ещё не завершена. Повторите позже.')); return; }
  if (Number(req.headers['content-length'] || 0) > MAX_TOTAL_BYTES) { next(new AppError(413, 'Общий размер загрузки не должен превышать 40 МБ')); return; }
  activeUploads++;
  let released = false, received = 0;
  const release = () => { if (!released) { released = true; activeUploads--; } };
  res.once('finish', release); res.once('close', release);
  req.on('data', chunk => { received += chunk.length; if (received > MAX_TOTAL_BYTES) req.destroy(); });
  parse(req, res, next);
};

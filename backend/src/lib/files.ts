import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { env } from '../config/env';
import { AppError } from './errors';
export const MAX_FILES = 15, MAX_FILE_BYTES = 10 * 1024 * 1024, MAX_TOTAL_BYTES = 40 * 1024 * 1024;
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 20 });
export type SafeImage = { buffer: Buffer; mimeType: string; url: string };
export async function prepareImages(inputs: { buffer: Buffer; mimeType: string }[]): Promise<SafeImage[]> {
  if (!inputs.length || inputs.length > MAX_FILES || inputs.some(i => i.buffer.length > MAX_FILE_BYTES) || inputs.reduce((n, i) => n + i.buffer.length, 0) > MAX_TOTAL_BYTES) throw new AppError(413, 'Допускается до 15 файлов: до 10 МБ каждый, до 40 МБ суммарно');
  const images: SafeImage[] = [];
  await fs.mkdir(env.UPLOADS_DIR, { recursive: true });
  try {
    for (const input of inputs) {
      const b = input.buffer;
      const magic = b.subarray(0, 3).equals(Buffer.from([255,216,255])) ? 'jpeg' : b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' ? 'webp' : null;
      if (!magic) throw new AppError(415, 'Файл не является изображением PNG, JPG или WEBP');
      let buffer: Buffer;
      try {
        buffer = await sharp(b, { limitInputPixels: 20_000_000, failOn: 'error', pages: 1 }).rotate().resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).timeout({ seconds: 10 }).toBuffer();
      } catch { throw new AppError(415, 'Изображение повреждено или превышает допустимый размер'); }
      const filename = 'screenshot-' + randomUUID() + '.jpg';
      await fs.writeFile(path.join(env.UPLOADS_DIR, filename), buffer, { flag: 'wx', mode: 0o600 });
      images.push({ buffer, mimeType: 'image/jpeg', url: '/uploads/' + filename });
    }
    return images;
  } catch (error) { await deleteImages(images.map(i => i.url)); throw error; }
}
export function imageFilename(url: string): string | null {
  const filename = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : '';
  return /^screenshot-(?:[0-9]+-[0-9]+|[0-9a-f-]{36})\.(?:jpg|jpeg|png|webp)$/i.test(filename) ? filename : null;
}
export async function deleteImages(urls: string[]) {
  for (const url of urls) {
    const filename = imageFilename(url);
    if (filename) await fs.unlink(path.join(env.UPLOADS_DIR, filename)).catch(e => { if (e.code !== 'ENOENT') console.warn('Image cleanup failed'); });
  }
}

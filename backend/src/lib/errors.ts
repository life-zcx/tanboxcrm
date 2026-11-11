import { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
export const route = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof ZodError) { res.status(400).json({ error: 'Проверьте поля запроса', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }); return; }
  if (error instanceof AppError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof multer.MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Допускается до 15 изображений: до 10 МБ каждое, до 40 МБ суммарно' }); return; }
  if (error?.code === 'P2025') { res.status(404).json({ error: 'Запись не найдена' }); return; }
  if (error?.code === 'P2002') { res.status(409).json({ error: 'Такая запись уже существует' }); return; }
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Запрос слишком большой' }); return; }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Некорректный JSON' }); return; }
  console.error('Request failed:', error?.code || error?.name || 'UnknownError');
  res.status(503).json({ error: 'Сервис временно недоступен. Повторите запрос.' });
};

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs/promises';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env';
import { prisma } from './config/db';
import { requireAuth } from './middleware/auth.middleware';
import { route, AppError, errorHandler } from './lib/errors';
import { imageFilename } from './lib/files';
import { screenshotReference } from './modules/clients/client-deletion.service';
import authRoutes from './modules/auth/auth.routes';
import accessRoutes from './modules/auth/access.routes';
import clientsRoutes from './modules/clients/clients.routes';
import messagesRoutes from './modules/messages/messages.routes';
import aiRoutes from './modules/ai/ai.routes';
import dealsRoutes from './modules/deals/deals.routes';
import settingsRoutes from './modules/settings/settings.routes';
import whatsappRoutes from './whatsapp/whatsapp.routes';
import logsRoutes from './modules/logs/logs.routes';
import { systemLogger } from './lib/system-logger';
export function createApp(){
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy',env.TRUST_PROXY_HOPS);
  app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'same-origin'}}));
  app.use(cors({origin:env.APP_ORIGIN,credentials:true}));
  app.use(cookieParser());
  app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});

  // Логирование всех входящих HTTP-запросов к API бэкенда
  app.use((req, res, next) => {
    const isLogPoll =
      req.path === '/api/health' ||
      req.path === '/api/logs' ||
      req.path === '/api/whatsapp/logs' ||
      req.path === '/api/whatsapp/status' ||
      req.path === '/api/whatsapp/feed';
    if (isLogPoll) return next();

    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      systemLogger.log(
        'BACKEND',
        level,
        `${req.method} ${req.originalUrl || req.url} -> ${status} (${duration}ms)`
      );
    });
    next();
  });

  app.use('/api',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много запросов. Повторите позже.'}}));
  app.use('/api',(req,_res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const origin=req.get('origin'),site=req.get('sec-fetch-site');
      if((origin&&origin!==env.APP_ORIGIN)||site==='cross-site'){next(new AppError(403,'Запрос с другого сайта отклонён'));return;}
      if(!origin && req.cookies?.tanbox_session){next(new AppError(403,'Отсутствует Origin'));return;}
    }
    next();
  });
  app.use(express.json({limit:'256kb'}));
  app.get('/api/health',route(async(_req,res)=>{await prisma.$queryRaw`SELECT 1`;res.json({status:'ok',service:'Tanbox CRM'});}));
  app.use('/api/auth',rateLimit({windowMs:60000,limit:process.env.CRM_TEST_DATABASE==='1'?100:15,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много попыток входа. Подождите минуту.'}}),authRoutes);
  app.use('/api/access',accessRoutes);
  app.use('/uploads',requireAuth,route(async(req,res)=>{
    const filename=imageFilename('/uploads'+req.path);
    if(!filename)throw new AppError(404,'Изображение не найдено');
    const reference=await prisma.conversationChunk.findFirst({where:screenshotReference('/uploads/'+filename),select:{id:true}});
    if(!reference)throw new AppError(404,'Изображение не найдено');
    const filePath=path.join(env.UPLOADS_DIR,filename);
    try{await fs.access(filePath);}catch{throw new AppError(404,'Изображение не найдено');}
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    res.type(filename.split('.').pop()!);
    res.sendFile(filePath);
  }));
  app.use('/api/clients',requireAuth,clientsRoutes);
  app.use('/api/deals',requireAuth,dealsRoutes);
  app.use('/api/messages',requireAuth,messagesRoutes);
  app.use('/api/ai',requireAuth,aiRoutes);
  app.use('/api/settings',requireAuth,settingsRoutes);
  app.use('/api/whatsapp',requireAuth,whatsappRoutes);
  app.use('/api/logs',requireAuth,logsRoutes);
  app.use((_req,_res,next)=>next(new AppError(404,'Маршрут не найден')));
  app.use(errorHandler);
  return app;
}

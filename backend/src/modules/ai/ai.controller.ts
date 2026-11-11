import { z } from 'zod';
import { aiOrchestrator } from '../../ai/ai.orchestrator';
import { telegramBotService } from '../../bot/telegram.bot';
import { TANBOX_KNOWLEDGE } from '../../ai/knowledge.service';
import { route } from '../../lib/errors';
import { idSchema, text } from '../../lib/validation';
import {pricingAvailability} from '../../pricing/pricing.service';
export const getAIStatus=route(async(_req,res)=>{res.json({
  providers:aiOrchestrator.getProvidersStatus(),
  telegramBot:telegramBotService.getStatus(),
  knowledgeBase:{...await pricingAvailability(),categoriesCount:TANBOX_KNOWLEDGE.categories.length,jurisdiction:TANBOX_KNOWLEDGE.jurisdiction,retrievalEnabled:true},
});});
export const suggestReply=route(async(req,res)=>{
  const options=z.object({clientId:idSchema,quoteId:idSchema.optional(),userPrompt:text(3000).optional(),provider:z.enum(['GEMINI','OPENAI','AUTO']).optional(),style:z.enum(['BUSINESS','FRIENDLY','CLOSING','EXPERT']).optional(),intent:z.enum(['REPLY','COMMERCIAL_OFFER']).optional()}).strict().parse(req.body);
  res.json({suggestion:await aiOrchestrator.generateSuggestedReply(options)});
});
export const getDraftChat=route(async(req,res)=>{
  const query=z.object({clientId:idSchema,intent:z.enum(['REPLY','COMMERCIAL_OFFER'])}).strict().parse(req.query);
  res.json({entries:await aiOrchestrator.listDraftChat(query.clientId,query.intent)});
});
export const reviseDraft=route(async(req,res)=>{
  const options=z.object({clientId:idSchema,suggestionId:idSchema,instruction:text(3000),style:z.enum(['BUSINESS','FRIENDLY','CLOSING','EXPERT']).optional()}).strict().parse(req.body);
  res.json({suggestion:await aiOrchestrator.reviseDraft(options)});
});

import { Router } from 'express';
import { getAIStatus, suggestReply, getDraftChat, reviseDraft } from './ai.controller';
import {getPricing,createQuote,listQuotes,revokeQuote} from '../../pricing/pricing.controller';

const router = Router();

router.get('/status', getAIStatus);
router.post('/suggest-reply', suggestReply);
router.get('/draft-chat',getDraftChat);
router.post('/draft-chat/revise',reviseDraft);
router.get('/pricing',getPricing);
router.get('/quotes',listQuotes);
router.post('/quotes',createQuote);
router.post('/quotes/:id/revoke',revokeQuote);

export default router;


import { Router } from 'express';
import { getDeals, createDeal, updateDealStage } from './deals.controller';

const router = Router();

router.get('/', getDeals);
router.post('/', createDeal);
router.put('/:id/stage', updateDealStage);

export default router;


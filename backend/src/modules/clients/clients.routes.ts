import { Router } from 'express';
import {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  getStatsSummary
} from './clients.controller';

const router = Router();

router.get('/stats/summary', getStatsSummary);
router.get('/', getClients);
router.get('/:id', getClientById);
router.post('/', createClient);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);

export default router;


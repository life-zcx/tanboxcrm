import { Router } from 'express';
import { uploadScreenshots } from '../../middleware/upload.middleware';
import {
  previewScreenshotHandler, commitScreenshotHandler,
  ingestTextDialogueHandler,
  addManualMessagesHandler,
  getClientConversations, getChunkMessages
} from './messages.controller';

const router = Router();

router.post('/preview-screenshot', uploadScreenshots, previewScreenshotHandler);
router.post('/commit-screenshot', uploadScreenshots, commitScreenshotHandler);
router.post('/ingest-text', ingestTextDialogueHandler);
router.post('/client/:clientId/manual', addManualMessagesHandler);
router.get('/client/:clientId', getClientConversations);
router.get('/chunk/:chunkId/messages', getChunkMessages);

export default router;


import { Router } from 'express';
import {
  getKnowledgeBase,
  createKnowledgeItem,
  deleteKnowledgeItem
} from './settings.controller';
import {listLibrary,getLibraryDocument,downloadLibrarySource,verifyLibrary,exportLibrary} from '../../knowledge/archive.controller';
import {getWebOverview,getWebDocument,getWebRaw,getWebSearch,getMarkingListLookup,triggerWebCollection} from '../../knowledge/web.controller';

const router = Router();

router.get('/knowledge', getKnowledgeBase);
router.get('/knowledge/web',getWebOverview);
router.get('/knowledge/web/search',getWebSearch);
router.get('/knowledge/web/list-lookup',getMarkingListLookup);
router.get('/knowledge/web/documents/:id',getWebDocument);
router.get('/knowledge/web/documents/:id/raw',getWebRaw);
router.post('/knowledge/web/collect',triggerWebCollection);
router.get('/knowledge/library',listLibrary);
router.get('/knowledge/library/verify',verifyLibrary);
router.get('/knowledge/library/export',exportLibrary);
router.get('/knowledge/library/documents/:id',getLibraryDocument);
router.get('/knowledge/library/sources/:id',downloadLibrarySource);
router.post('/knowledge', createKnowledgeItem);
router.delete('/knowledge/:id', deleteKnowledgeItem);

export default router;


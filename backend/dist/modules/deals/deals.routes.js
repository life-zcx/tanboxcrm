"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const deals_controller_1 = require("./deals.controller");
const router = (0, express_1.Router)();
router.get('/', deals_controller_1.getDeals);
router.post('/', deals_controller_1.createDeal);
router.put('/:id/stage', deals_controller_1.updateDealStage);
exports.default = router;

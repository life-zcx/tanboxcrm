"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const telegram_oidc_1 = require("./telegram-oidc");
const router = (0, express_1.Router)();
router.post('/request-code', auth_controller_1.requestCode);
router.post('/verify-code', auth_controller_1.verifyCode);
router.get('/telegram/config', telegram_oidc_1.telegramLoginConfig);
router.get('/telegram/start', telegram_oidc_1.startTelegramLogin);
router.get('/telegram/callback', telegram_oidc_1.finishTelegramLogin);
router.get('/me', (req, res, next) => {
    if (!req.cookies?.tanbox_session) {
        res.json({ user: null });
        return;
    }
    (0, auth_middleware_1.requireAuth)(req, res, next);
}, auth_controller_1.getMe);
router.post('/logout', auth_middleware_1.requireAuth, auth_controller_1.logout);
exports.default = router;

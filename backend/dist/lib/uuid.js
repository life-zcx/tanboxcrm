"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUUID = void 0;
const isUUID = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
exports.isUUID = isUUID;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusToStage = exports.stageToStatus = exports.pagination = exports.clientInput = exports.numberField = exports.nullableText = exports.text = exports.idSchema = exports.categories = exports.dealStages = exports.clientStatuses = void 0;
exports.normalizePhone = normalizePhone;
const zod_1 = require("zod");
exports.clientStatuses = ['LEAD', 'IN_NEGOTIATION', 'KP_SENT', 'PAYMENT_PENDING', 'IN_PROGRESS', 'WON', 'LOST'];
exports.dealStages = ['NEW', 'QUALIFIED', 'OFFER_SENT', 'INVOICED', 'PAID', 'CLOSED_LOST'];
exports.categories = ['SHOES', 'CLOTHES', 'MEDICINE', 'WATER', 'TOBACCO', 'OTHER'];
exports.idSchema = zod_1.z.string().uuid();
const text = (max = 2000) => zod_1.z.string().trim().min(1).max(max);
exports.text = text;
const nullableText = (max = 2000) => zod_1.z.string().trim().max(max).nullable().optional();
exports.nullableText = nullableText;
exports.numberField = zod_1.z.number().finite().nonnegative().max(1e12).nullable().optional();
function normalizePhone(value) {
    if (!value)
        return null;
    let digits = value.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8'))
        digits = '7' + digits.slice(1);
    return /^\d{10,15}$/.test(digits) ? digits : null;
}
const phone = zod_1.z.string().trim().max(40).refine(v => !v || normalizePhone(v) !== null, 'Некорректный телефон').nullable().optional().transform(v => v === undefined ? undefined : normalizePhone(v));
exports.clientInput = zod_1.z.object({
    name: (0, exports.text)(200).optional(), phone, company: (0, exports.nullableText)(300), binIin: zod_1.z.string().regex(/^\d{12}$/).nullable().optional(),
    category: zod_1.z.enum(exports.categories).nullable().optional(), status: zod_1.z.enum(exports.clientStatuses).optional(),
    estimatedVolume: zod_1.z.number().int().nonnegative().max(1e9).nullable().optional(), estimatedAmount: exports.numberField, notes: (0, exports.nullableText)(10000),
}).strict();
const pagination = (query, defaultLimit = 50) => ({
    skip: zod_1.z.coerce.number().int().min(0).max(1e7).default(0).parse(query.offset),
    take: zod_1.z.coerce.number().int().min(1).max(100).default(defaultLimit).parse(query.limit),
});
exports.pagination = pagination;
exports.stageToStatus = { NEW: 'LEAD', QUALIFIED: 'IN_NEGOTIATION', OFFER_SENT: 'KP_SENT', INVOICED: 'PAYMENT_PENDING', PAID: 'WON', CLOSED_LOST: 'LOST' };
exports.statusToStage = { LEAD: 'NEW', IN_NEGOTIATION: 'QUALIFIED', KP_SENT: 'OFFER_SENT', PAYMENT_PENDING: 'INVOICED', IN_PROGRESS: 'PAID', WON: 'PAID', LOST: 'CLOSED_LOST' };

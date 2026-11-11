import { z } from 'zod';
export const clientStatuses = ['LEAD', 'IN_NEGOTIATION', 'KP_SENT', 'PAYMENT_PENDING', 'IN_PROGRESS', 'WON', 'LOST'] as const;
export const dealStages = ['NEW', 'QUALIFIED', 'OFFER_SENT', 'INVOICED', 'PAID', 'CLOSED_LOST'] as const;
export const categories = ['SHOES', 'CLOTHES', 'MEDICINE', 'WATER', 'TOBACCO', 'OTHER'] as const;
export const idSchema = z.string().uuid();
export const text = (max = 2000) => z.string().trim().min(1).max(max);
export const nullableText = (max = 2000) => z.string().trim().max(max).nullable().optional();
export const numberField = z.number().finite().nonnegative().max(1e12).nullable().optional();
export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  return /^\d{10,15}$/.test(digits) ? digits : null;
}
const phone = z.string().trim().max(40).refine(v => !v || normalizePhone(v) !== null, 'Некорректный телефон').nullable().optional().transform(v => v === undefined ? undefined : normalizePhone(v));
export const clientInput = z.object({
  name: text(200).optional(), phone, company: nullableText(300), binIin: z.string().regex(/^\d{12}$/).nullable().optional(),
  category: z.enum(categories).nullable().optional(), status: z.enum(clientStatuses).optional(),
  estimatedVolume: z.number().int().nonnegative().max(1e9).nullable().optional(), estimatedAmount: numberField, notes: nullableText(10000),
}).strict();
export const pagination = (query: Record<string, unknown>, defaultLimit = 50) => ({
  skip: z.coerce.number().int().min(0).max(1e7).default(0).parse(query.offset),
  take: z.coerce.number().int().min(1).max(100).default(defaultLimit).parse(query.limit),
});
export const stageToStatus: Record<string, typeof clientStatuses[number]> = { NEW: 'LEAD', QUALIFIED: 'IN_NEGOTIATION', OFFER_SENT: 'KP_SENT', INVOICED: 'PAYMENT_PENDING', PAID: 'WON', CLOSED_LOST: 'LOST' };
export const statusToStage: Record<string, string> = { LEAD: 'NEW', IN_NEGOTIATION: 'QUALIFIED', KP_SENT: 'OFFER_SENT', PAYMENT_PENDING: 'INVOICED', IN_PROGRESS: 'PAID', WON: 'PAID', LOST: 'CLOSED_LOST' };

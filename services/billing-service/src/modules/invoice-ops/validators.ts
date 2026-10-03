import { z } from "zod";
import { OFFLINE_MODES } from "./domain.js";

const paise = z.union([z.string().regex(/^\d{1,18}$/, "must be an integer number of paise"), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
  .transform((v) => BigInt(v));

export const offlinePaymentBody = z.object({
  mode: z.enum(OFFLINE_MODES),
  reference: z.string().trim().min(1).max(60),
  paidOn: z.string(),
  amountMinor: paise,
  reason: z.string().trim().min(3).max(500),
}).strict();

export const decisionBody = z.object({
  approve: z.boolean(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();

export const makerCheckerBody = z.object({ enabled: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict();
export const reminderDaysBody = z.object({ days: z.number().int().min(1).max(365).nullable() }).strict();

export const invoiceIdParam = z.object({ id: z.string().uuid() });
export const requestParam = z.object({ id: z.string().uuid(), reqId: z.string().uuid() });
export const settingsRequestParam = z.object({ reqId: z.string().uuid() });

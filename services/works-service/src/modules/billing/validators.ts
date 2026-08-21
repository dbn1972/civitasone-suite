import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas";

export const issueMbSchema = z.object({
  workId: z.string().uuid(),
  awardId: z.string().uuid(),
  mbNumber: z.string().min(1).max(64),
});

export const recordMeasurementSchema = z.object({
  mbId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  quantity: z.number().positive(),
  numberVal: z.number().optional(),
  lengthVal: z.number().optional(),
  breadthVal: z.number().optional(),
  depthVal: z.number().optional(),
  remarks: z.string().max(2048).optional(),
});

export const finalizeMbSchema = z.object({
  id: z.string().uuid(),
  nextStatus: z.enum(["so_finalized", "sdo_finalized", "estimator_finalized", "do_finalized"]),
});

export const createBillSchema = z.object({
  workId: z.string().uuid(),
  awardId: z.string().uuid(),
  // No-3-way-match fix: every bill (abstract or e_mb) must be backed by a
  // real, finalized measurement-book entry — mbId is no longer optional.
  // See billing/routes.ts and billing/consumer.ts for the full chain this
  // now enforces: mb belongs to the same work+award, mb is do_finalized,
  // and the bill's gross amount does not exceed the mb's measured value.
  mbId: z.string().uuid(),
  billMode: z.enum(["abstract", "e_mb"]),
  billNumber: z.string().min(1).max(64),
  grossAmountMinor: zMoneyMinorString,
  deductionsMinor: zMoneyMinorString.optional(),
});

export const finalizeBillSchema = z.object({
  id: z.string().uuid(),
  nextStatus: z.enum(["so_finalized", "sdo_finalized", "auditor_finalized", "dao_finalized", "do_finalized"]),
});

export const compileAccountSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  submittedTo: z.string().max(256).optional(),
});

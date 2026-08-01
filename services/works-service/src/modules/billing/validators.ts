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
  nextStatus: z.string().min(1),
});

export const createBillSchema = z.object({
  workId: z.string().uuid(),
  awardId: z.string().uuid(),
  mbId: z.string().uuid().optional(),
  billMode: z.enum(["abstract", "e_mb"]),
  billNumber: z.string().min(1).max(64),
  grossAmountMinor: zMoneyMinorString,
  deductionsMinor: zMoneyMinorString.optional(),
});

export const finalizeBillSchema = z.object({
  id: z.string().uuid(),
  nextStatus: z.string().min(1),
});

export const compileAccountSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  submittedTo: z.string().max(256).optional(),
});

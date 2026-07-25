import { z } from "zod";

export const createPreTenderSchema = z.object({
  workId: z.string().uuid(),
  referenceNumber: z.string().max(128).optional(),
  tenderType: z.string().max(64).optional(),
  tenderCategory: z.string().max(64).optional(),
  bidValidity: z.number().int().optional(),
  fees: z.string().or(z.number()).optional(),
});

export const createTenderSchema = z.object({
  workId: z.string().uuid(),
  tenderTypeId: z.string().uuid().optional(),
  tenderAmountMinor: z.string().or(z.number()),
  approvingAuthorityId: z.string().uuid().optional(),
  contractorClassId: z.string().uuid().optional(),
  remarks: z.string().max(2048).optional(),
});

export const addQuotationSchema = z.object({
  tenderId: z.string().uuid(),
  contractorName: z.string().min(1).max(256),
  method: z.enum(["percentage_rate", "item_rate"]),
  quotedAmountMinor: z.string().or(z.number()).optional(),
  quotedPercentage: z.string().max(16).optional(),
  aboveOrBelowOrAtPar: z.enum(["above", "below", "at_par"]).optional(),
});

export const createAwardSchema = z.object({
  workId: z.string().uuid(),
  contractorName: z.string().min(1).max(256),
  agreementNumber: z.string().max(128).optional(),
  workOrderNumber: z.string().max(128).optional(),
  workPeriodDays: z.number().int().optional(),
  billMode: z.enum(["abstract", "e_mb"]).optional(),
  acceptedAmountMinor: z.string().or(z.number()),
});

export const finalizeAwardSchema = z.object({
  id: z.string().uuid(),
});

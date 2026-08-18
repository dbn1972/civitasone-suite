import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas";

export const createAaSchema = z.object({
  workId: z.string().uuid(),
  aaNumber: z.string().min(1).max(64),
  aaDate: z.string(),
  approvingAuthorityId: z.string().uuid(),
  approvingOfficeId: z.string().uuid().optional(),
  approvedAmountMinor: zMoneyMinorString,
  remarks: z.string().max(2048).optional(),
});

export const createTsSchema = z.object({
  workId: z.string().uuid(),
  tsNumber: z.string().min(1).max(64),
  tsDate: z.string(),
  tsAuthorityId: z.string().uuid(),
  tsOfficeId: z.string().uuid().optional(),
  srYear: z.string().max(16).optional(),
  zone: z.string().max(64).optional(),
  tsAmountMinor: zMoneyMinorString,
  remarks: z.string().max(2048).optional(),
});

export const finalizeApprovalSchema = z.object({
  id: z.string().uuid(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

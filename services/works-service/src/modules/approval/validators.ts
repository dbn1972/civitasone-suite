import { z } from "zod";
import { zCalendarDate, zPositiveMoneyMinor } from "../../shared/validators.js";

export const createAaSchema = z.object({
  workId: z.string().uuid(),
  aaNumber: z.string().min(1).max(64),
  // A real calendar date: a bad one used to be accepted with 202 and then threw inside the consumer.
  aaDate: zCalendarDate,
  approvingAuthorityId: z.string().uuid(),
  approvingOfficeId: z.string().uuid().optional(),
  // An approved amount is strictly positive public money; zero and negative values are rejected at the boundary.
  approvedAmountMinor: zPositiveMoneyMinor,
  remarks: z.string().max(2048).optional(),
});

export const createTsSchema = z.object({
  workId: z.string().uuid(),
  tsNumber: z.string().min(1).max(64),
  tsDate: zCalendarDate,
  tsAuthorityId: z.string().uuid(),
  tsOfficeId: z.string().uuid().optional(),
  srYear: z.string().max(16).optional(),
  zone: z.string().max(64).optional(),
  tsAmountMinor: zPositiveMoneyMinor,
  remarks: z.string().max(2048).optional(),
});

export const finalizeApprovalSchema = z.object({
  id: z.string().uuid(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

import { z } from "zod";

export const createLedgerBody = z.object({
  subscriptionId: z.string().uuid(),
  totalAmountPaise: z.string().regex(/^\d+$/, "must be a non-negative integer string"),
  servicePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD"),
  servicePeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD"),
});

export const idParam = z.object({
  id: z.string().uuid(),
});

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

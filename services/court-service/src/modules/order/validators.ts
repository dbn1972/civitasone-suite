import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const orderIdParam = z.object({ id: z.string().uuid() });

/** Record (draft) an order on a case (§23). `orderDate` is a calendar date. */
export const recordOrderBody = z.object({
  hearingId: z.string().uuid().optional(),
  orderType: z.string().trim().min(1).max(32),
  orderText: z.string().trim().min(1).max(20000),
  orderDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "orderDate must be YYYY-MM-DD").optional(),
});
export type RecordOrderBody = z.infer<typeof recordOrderBody>;

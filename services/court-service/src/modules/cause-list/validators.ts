import { z } from "zod";

export const causeListIdParam = z.object({ id: z.string().uuid() });

/** Generate (materialize) a cause-list for a court/day (§17). `listDate` is a calendar date. */
export const createCauseListBody = z.object({
  courtId:  z.string().uuid(),
  benchId:  z.string().uuid().optional(),
  listDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "listDate must be YYYY-MM-DD"),
  listType: z.string().trim().max(32).optional(),
});
export type CreateCauseListBody = z.infer<typeof createCauseListBody>;

/** List a case onto a slot/courtroom of a cause-list (§17). */
export const listCaseBody = z.object({
  caseId:     z.string().uuid(),
  itemNumber: z.coerce.number().int().min(1),
  slot:       z.string().trim().min(1).max(32),
  courtroom:  z.string().trim().min(1).max(64),
});
export type ListCaseBody = z.infer<typeof listCaseBody>;

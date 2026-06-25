import { z } from "zod";

export const recordFilingBody = z.object({
  caseId:      z.string().uuid(),
  filingType:  z.enum(["affidavit", "petition", "reply", "rejoinder", "written_statement", "application", "appeal"]),
  title:       z.string().min(1).max(256),
  court:       z.string().min(1).max(128),
  filingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "filingDate must be YYYY-MM-DD"),
  referenceNo: z.string().max(128).optional(),
  status:      z.enum(["drafted", "filed"]).default("filed"),
});
export type RecordFilingBody = z.infer<typeof recordFilingBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listFilingsQuery = z.object({
  caseId:     z.string().uuid().optional(),
  filingType: z.string().max(32).optional(),
  status:     z.enum(["drafted", "filed"]).optional(),
});

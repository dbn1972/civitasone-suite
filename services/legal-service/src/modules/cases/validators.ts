import { z } from "zod";

const partySchema = z.object({
  name: z.string().min(1).max(256),
  role: z.enum(["petitioner", "respondent", "intervener"]).default("respondent"),
});

export const createCaseBody = z.object({
  caseNo:     z.string().min(1).max(64),
  title:      z.string().min(1).max(256),
  court:      z.string().min(1).max(128),
  subject:    z.string().max(512).optional(),
  caseTypeId: z.string().uuid().optional(),
  petitioner: z.string().max(256).optional(),
  counselRef: z.string().max(128).optional(),
  parties:    z.array(partySchema).optional(),
});
export type CreateCaseBody = z.infer<typeof createCaseBody>;

export const disposeCaseBody = z.object({
  disposition: z.string().min(1).max(500),
});
export type DisposeCaseBody = z.infer<typeof disposeCaseBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listCasesQuery = z.object({
  status: z.enum(["pending", "disposed", "appealed", "stayed", "settled"]).optional(),
  type:   z.string().uuid().optional(),
});

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

/**
 * GAP-LEGAL-CASES-NEW-01: case-type master. A case type is a tenant-scoped
 * (code, name) pair; `code` is the stable machine key the adverse-risk logic
 * and the create-case select key off, `name` is the human label. `code` is
 * lower-snake/kebab-ish and bounded; the DB enforces UNIQUE (tenant_id, code).
 */
export const createCaseTypeBody = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[a-z0-9_]+$/, "code must be lower-case letters, digits or underscores"),
  name: z.string().trim().min(1).max(128),
});
export type CreateCaseTypeBody = z.infer<typeof createCaseTypeBody>;

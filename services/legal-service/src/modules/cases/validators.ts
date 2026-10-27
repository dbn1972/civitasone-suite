import { z } from "zod";

const partySchema = z.object({
  name: z.string().min(1).max(256),
  role: z.enum(["petitioner", "respondent", "intervener"]).default("respondent"),
});

function isRealPastOrToday(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  // one day of slack so a filing dated "today" in IST is never rejected by a UTC clock
  return d.getTime() <= Date.now() + 86_400_000;
}

export const createCaseBody = z.object({
  caseNo:     z.string().min(1).max(64),
  title:      z.string().min(1).max(256),
  // Owner decision #10: pick a court from the master (courtCode) or use courtCode "other" + free text.
  // A master code wins: the stored name is the master's canonical name, whatever `court` says.
  court:      z.string().trim().max(128).optional(),
  courtCode:  z.string().trim().min(1).max(40).optional(),
  filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "filing date must be YYYY-MM-DD").refine(isRealPastOrToday, "filing date must be a real date, not in the future"),
  departmentId: z.string().uuid(),
  subject:    z.string().max(512).optional(),
  caseTypeId: z.string().uuid().optional(),
  petitioner: z.string().max(256).optional(),
  counselRef: z.string().max(128).optional(),
  advocateId: z.string().uuid().optional(),
  // Owner decision #8: officers the case is assigned to (reminder recipients).
  assignedOfficerIds: z.array(z.string().uuid()).max(20).optional(),
  // Owner decision #12: restrict the case to its assigned officers and the legal head.
  privileged: z.boolean().optional(),
  parties:    z.array(partySchema).optional(),
}).superRefine((v, ctx) => {
  if ((v.courtCode === undefined || v.courtCode === "other") && !(v.court && v.court.length > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["court"], message: "court name is required when the court is not picked from the list" });
  }
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

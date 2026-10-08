import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });
/** P0-3: citizenId is optional in input — resolved/constrained from the actor. */
export const citizenIdQuery = z.object({ citizenId: z.string().uuid().optional() });

export const registerGrievanceBody = z.object({
  citizenId:   z.string().uuid().optional(),
  // P1-7: capped, control-char-stripped, CSV-injection-guarded free text.
  category:    safeText({ max: 64 }),
  subject:     safeText({ max: 200 }),
  description: safeText({ max: 5000, multiline: true }),
  // GAP-CITIZEN-GRIEVANCES-NEW-02: complainant name (free text, capped).
  complainantName: safeText({ max: 200 }).optional(),
  // GAP-CITIZEN-GRIEVANCES-NEW-02/04: optional complainant contact channels.
  complainantContact: z
    .array(z.object({ kind: z.enum(["mobile", "email"]), value: safeText({ max: 320 }) }))
    .max(5)
    .optional(),
  // GAP-CITIZEN-GRIEVANCES-NEW-02: when an officer files for a citizen, flag it.
  // The authoritative filing actor is derived server-side from the JWT, never
  // the client; this only records the officer's INTENT to file on behalf.
  filedOnBehalf: z.boolean().optional(),
  // GAP-CITIZEN-GRIEVANCES-NEW-01: structured DPDP consent record. The server
  // stamps the authoritative time; the client cannot be trusted for it.
  dpdpConsent: z
    .object({
      given: z.boolean(),
      noticeVersion: safeText({ max: 32 }),
      purpose: safeText({ max: 64 }),
    })
    .optional(),
});
export type RegisterGrievanceBody = z.infer<typeof registerGrievanceBody>;

export const assignGrievanceBody = z.object({
  assignedTo:    z.string().uuid(),
  departmentRef: safeText({ max: 128 }).optional(),
});
export type AssignGrievanceBody = z.infer<typeof assignGrievanceBody>;

export const grievanceActionBody = z.object({
  actionType: safeText({ max: 64 }),
  note:       safeText({ max: 2000, multiline: true }).optional(),
  status:     z.enum(["in_progress", "resolved"]).optional(),
});
export type GrievanceActionBody = z.infer<typeof grievanceActionBody>;

export const resolveGrievanceBody = z.object({
  note: safeText({ max: 2000, multiline: true }).optional(),
});
export type ResolveGrievanceBody = z.infer<typeof resolveGrievanceBody>;

export const escalateGrievanceBody = z.object({
  reason:      safeText({ max: 1000, multiline: true }),
  escalatedTo: z.string().uuid().optional(),
});
export type EscalateGrievanceBody = z.infer<typeof escalateGrievanceBody>;

export const reopenGrievanceBody = z.object({
  reason: safeText({ max: 1000, multiline: true }),
});
export type ReopenGrievanceBody = z.infer<typeof reopenGrievanceBody>;

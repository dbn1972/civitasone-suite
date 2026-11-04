/**
 * PR #2459 review B1 (ERP-head decision 2026-11-05): opening year-to-date of an
 * employee for an FY, used by the s.192 projection as AUTHORITATIVE figures.
 *   pre_go_live    salary paid and TDS deducted by this employer before the
 *                  payroll went live here, and the months they cover;
 *   prior_employer income and TDS of a previous employer in the FY (Form 12B,
 *                  s.192(2)): name and TAN.
 * Money: integer paise as digit strings.
 */
import { z } from "zod";

const paise = z.string().regex(/^\d{1,15}$/, "must be an integer number of paise");
const fy = z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-YY")
  .refine((v) => Number(v.slice(5)) === (Number(v.slice(0, 4)) + 1) % 100, "must be a real financial year (e.g. 2026-27)");

export const createOpeningYtdBody = z.object({
  employeeId: z.string().uuid(),
  fy,
  source: z.enum(["pre_go_live", "prior_employer"]),
  months: z.number().int().min(0).max(11).default(0),
  salaryMinor: paise,
  tdsMinor: paise,
  priorEmployerName: z.string().trim().min(2).max(200).optional(),
  priorEmployerTan: z.string().trim().toUpperCase().regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "TAN must look like ABCD12345E").optional(),
  note: z.string().trim().min(10).max(1000),
}).superRefine((b, ctx) => {
  if (b.source === "pre_go_live" && b.months < 1) ctx.addIssue({ code: "custom", path: ["months"], message: "pre_go_live needs the number of months it covers (1..11)" });
  if (b.source === "prior_employer" && !b.priorEmployerName) ctx.addIssue({ code: "custom", path: ["priorEmployerName"], message: "prior_employer needs the employer name (Form 12B)" });
});
export type CreateOpeningYtdBody = z.infer<typeof createOpeningYtdBody>;

export const decideOpeningYtdBody = z.object({ reason: z.string().trim().min(10).max(1000) });
export const listOpeningYtdQuery = z.object({ employeeId: z.string().uuid().optional(), fy: fy.optional() });
export const idParam = z.object({ id: z.string().uuid() });

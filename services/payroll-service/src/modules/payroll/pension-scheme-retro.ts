/**
 * UAT b18 D1: retro impact of a back-dated pension scheme change.
 *
 * HRMS approves a scheme change (GPF / NPS / EPF / UPS) with an effective-from
 * month. Payroll uses the scheme in effect for each period from then on, but
 * slips already computed for months on/after the effective date are NEVER
 * recomputed or adjusted automatically (owner rule: no retro change of slips,
 * any retro difference is reported, not posted). This read-only report lists
 * those slips with the scheme they were computed under, so HR / payroll can
 * decide on an arrears or recovery through the normal approved flows.
 *
 * GET /v1/payroll/reports/pension-scheme-retro?employeeId=&fromMonth=YYYY-MM&toScheme=EPF
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];

export type ComputedScheme = "GPF" | "NPS" | "UPS" | "EPF" | "NONE";

/**
 * Pure: which scheme a slip was computed under, from its own deduction columns.
 * UPS and NPS share the PRAN ledger; the Government share on it tells them
 * apart: NPS 14%, UPS 10% (individual corpus; the 8.5% pool share is booked
 * separately), against the same 10% employee share.
 */
export function computedSchemeOf(s: { gpfMinor: bigint; npsEmployeeMinor: bigint; npsEmployerMinor: bigint; pfEmployeeMinor: bigint }): ComputedScheme {
  if (s.gpfMinor > 0n) return "GPF";
  if (s.npsEmployeeMinor > 0n) return s.npsEmployerMinor * 100n >= s.npsEmployeeMinor * 120n ? "NPS" : "UPS";
  if (s.pfEmployeeMinor > 0n) return "EPF";
  return "NONE";
}

const query = z.object({
  employeeId: z.string().uuid(),
  fromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "fromMonth must be YYYY-MM"),
  toScheme: z.enum(["GPF", "NPS", "EPF", "UPS"]),
});

export async function pensionSchemeRetroRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/reports/pension-scheme-retro", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = query.parse(req.query);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT s.id AS slip_id, s.run_id, r.run_no, r.month, r.status AS run_status, s.status AS slip_status,
             s.gpf_minor::text AS gpf, s.nps_employee_minor::text AS nps_ee, s.nps_employer_minor::text AS nps_er,
             s.pf_employee_minor::text AS pf_ee, s.pf_employer_minor::text AS pf_er
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${ctx.tenantId}::uuid AND s.employee_id = ${q.employeeId}::uuid
        AND r.month >= ${q.fromMonth} AND s.status <> ${"excluded"}
        AND r.status NOT IN (${"failed"}, ${"cancelled"})
      ORDER BY r.month, r.run_no
    `))) as unknown as Array<{
      slip_id: string; run_id: string; run_no: string; month: string; run_status: string; slip_status: string;
      gpf: string; nps_ee: string; nps_er: string; pf_ee: string; pf_er: string;
    }>;
    const slips = rows.map((r) => {
      const computed = computedSchemeOf({
        gpfMinor: BigInt(r.gpf ?? 0), npsEmployeeMinor: BigInt(r.nps_ee ?? 0),
        npsEmployerMinor: BigInt(r.nps_er ?? 0), pfEmployeeMinor: BigInt(r.pf_ee ?? 0),
      });
      return {
        slipId: r.slip_id, runId: r.run_id, runNo: r.run_no, month: r.month, runStatus: r.run_status,
        computedScheme: computed,
        schemeInEffect: q.toScheme,
        differs: computed !== q.toScheme,
        employeePensionDeductionMinor: (BigInt(r.gpf ?? 0) + BigInt(r.nps_ee ?? 0) + BigInt(r.pf_ee ?? 0)).toString(),
        employerPensionContributionMinor: (BigInt(r.nps_er ?? 0) + BigInt(r.pf_er ?? 0)).toString(),
      };
    });
    return reply.send({
      employeeId: q.employeeId,
      fromMonth: q.fromMonth,
      toScheme: q.toScheme,
      postingPolicy: "report_only",
      note: "Slips already computed keep the scheme they were computed under. No arrears or recovery is raised automatically; settle any difference through an approved arrears / correction.",
      affectedCount: slips.filter((s) => s.differs).length,
      slips,
    });
  });
}

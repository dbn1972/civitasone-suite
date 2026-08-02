import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, enforceEmployeeOwnership } from "../../shared/context.js";
import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { payrollTds, payrollNps, payrollTdsNonSalary } from "../statutory/schema.js";
import { perquisiteComponents } from "../tax/schema.js";
import { payrollRuns } from "../payroll/schema.js";
import { taxDeclarations } from "../tax/schema.js";
import { buildForm16, parseFy } from "../tax/form16.js";
import { fetchPayrollInput, HrmsUnavailableError, type PayrollInputEmployee } from "../../shared/hrms-client.js";
import { reconcilePeriod, reconcileNonSalaryPeriod, type Reconciliation } from "./challan-routes.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as taxCommands from "../tax/commands.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES = [...STATUTORY_ROLES, "hr_admin", "finance_officer", "employee"];
// C1: Form 24Q is a deductor-wide e-TDS return exposing every deductee's PAN/TDS.
// It must NOT be readable by the self-service `employee` role — admins/officers only.
const RETURN_FILER_ROLES = [...STATUTORY_ROLES, "hr_admin", "finance_officer"];
const AUDIT_TOPIC = "audit.event.record";
const perquisiteComponentBody = z.object({
  employeeId: z.string().uuid(),
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  nature: z.string().trim().min(1).max(64),
  description: z.string().max(255).optional(),
  valueByEmployer: z.number().finite().nonnegative().max(1_000_000_000_000),
  amountRecovered: z.number().finite().nonnegative().max(1_000_000_000_000).optional(),
});

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

/** M5: strict-parse FY and surface malformed input as a 400 (not a 500). */
function parseFyOr400(fy: string): { startYear: number; endYear: number } {
  try { return parseFy(fy); }
  catch (e) { throw new HttpError(400, "VALIDATION_FAILED", (e as Error).message); }
}

/** Apr–Mar months belonging to a 24Q quarter of the FY starting `startYear`. */
function quarterMonths(startYear: number, q: Quarter): string[] {
  const map: Record<Quarter, Array<[number, number]>> = {
    // [calendar-year-offset (0=start,1=next), month]
    Q1: [[0, 4], [0, 5], [0, 6]],
    Q2: [[0, 7], [0, 8], [0, 9]],
    Q3: [[0, 10], [0, 11], [0, 12]],
    Q4: [[1, 1], [1, 2], [1, 3]],
  };
  return map[q].map(([off, m]) => `${startYear + off}-${String(m).padStart(2, "0")}`);
}

const employerIdentity = () => ({
  name: process.env.EMPLOYER_NAME ?? "<EMPLOYER NAME — configure EMPLOYER_NAME>",
  tan: process.env.EMPLOYER_TAN ?? "<TAN — configure EMPLOYER_TAN>",
  pan: process.env.EMPLOYER_PAN ?? "<PAN — configure EMPLOYER_PAN>",
});

/**
 * H4: pipe-delimited flat-file safety. Strip the field separator and CR/LF from
 * any free-text field (name/PAN/PRAN) so a crafted value cannot inject a new
 * record or misalign columns in 24Q / NPS-SCF files.
 */
const pipeSafe = (v: unknown): string => String(v ?? "").replace(/[|\r\n]/g, " ").trim();

/** Deductee-wise TDS aggregate for a set of months (one row per employee). */
async function deducteeWiseTds(tenantId: string, months: string[]): Promise<Map<string, { tds: number; periods: Set<string> }>> {
  // Restrict to disbursed/approved runs so we only report deposited TDS.
  const runs = await scopedRead((tx) => tx.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.month, months))));
  const validRunIds = new Set(runs.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id));

  const tdsRows = await scopedRead((tx) => tx.select().from(payrollTds)
    .where(and(eq(payrollTds.tenantId, tenantId), inArray(payrollTds.period, months))));

  const byEmp = new Map<string, { tds: number; periods: Set<string> }>();
  for (const t of tdsRows) {
    if (validRunIds.size > 0 && !validRunIds.has(t.runId)) continue;
    const e = byEmp.get(t.employeeId) ?? { tds: 0, periods: new Set<string>() };
    e.tds += Number(t.tdsMinor) / 100;
    e.periods.add(t.period);
    byEmp.set(t.employeeId, e);
  }
  return byEmp;
}

export async function statutoryReturnsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1[&format=file]
   * Quarterly e-TDS return (salary): deductee-wise TDS + challan summary.
   * Q4 also includes Annexure II (salary detail = Form 16 Part B figures).
   */
  app.get("/v1/payroll/statutory/form24q", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RETURN_FILER_ROLES);

    const { fy, quarter, format } = req.query as { fy?: string; quarter?: string; format?: string };
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2026-27)");
    const q = (quarter ?? "").toUpperCase() as Quarter;
    if (!QUARTERS.includes(q)) throw new HttpError(400, "VALIDATION_FAILED", "quarter must be one of Q1,Q2,Q3,Q4");

    const { startYear, endYear } = parseFyOr400(fy);
    const months = quarterMonths(startYear, q);

    // P1: TRACES reconciliation gate. Sum TDS deducted (payroll_tds, finalised
    // runs) vs deposited (challans) per month. Block 24Q when they do not match
    // unless the caller explicitly passes ?force=1 (then we flag, not block).
    const { force } = req.query as { force?: string };
    const reconciliation: Reconciliation[] = [];
    for (const mo of months) reconciliation.push(await reconcilePeriod(ctx.tenantId, mo, "24Q"));
    const reconciled = reconciliation.every((r) => r.matched);
    if (!reconciled && force !== "1") {
      throw new HttpError(409, "TDS_RECONCILIATION_FAILED",
        "24Q blocked: TDS deducted does not match deposited challans for " +
        reconciliation.filter((r) => !r.matched).map((r) => `${r.period}(${r.status})`).join(", ") +
        ". Ingest/correct challans or pass force=1 to generate a flagged return.");
    }
    // H3: a force=1 filing bypasses the reconciliation gate (unreconciled TDS).
    // This is a high-risk override — record an audit/outbox event with the actor,
    // period, and per-period variance so the forced filing is never silent.
    if (!reconciled && force === "1") {
      const unmatched = reconciliation.filter((r) => !r.matched);
      const totalVariance = unmatched.reduce((acc, r) => acc + BigInt(r.varianceMinor), 0n);
      // Exception: this read-side export performs no entity mutation; the
      // transaction persists only its mandatory audit outbox record.
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
          payload: {
            service: "payroll",
            action: "force_file_24q",
            resourceType: "statutory_return",
            resourceId: `24Q:${fy}:${q}`,
            outcome: "forced",
            fy, quarter: q,
            varianceMinor: totalVariance.toString(),
            unreconciledPeriods: unmatched.map((r) => ({
              period: r.period, status: r.status, varianceMinor: r.varianceMinor,
            })),
          },
        });
      });
    }

    const byEmp = await deducteeWiseTds(ctx.tenantId, months);

    // Employee master for PAN + name. M4: HRMS-unreachable must FAIL the return
    // (502) rather than emit blank PANs that look like genuine PANNOTAVBL flags.
    let master = new Map<string, PayrollInputEmployee>();
    try {
      const input = await fetchPayrollInput(ctx.tenantId, months[months.length - 1] ?? `${endYear}-03`);
      master = new Map(input.employees.map((e) => [e.id, e]));
    } catch (err) {
      if (err instanceof HrmsUnavailableError) {
        throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot generate Form 24Q: HRMS identity source unreachable");
      }
      throw err;
    }

    const deductees = [...byEmp.entries()].map(([employeeId, agg]) => {
      const emp = master.get(employeeId);
      const tdsDeducted = Math.round(agg.tds);
      return {
        employeeId,
        pan: emp?.pan ?? "",
        panFlag: emp?.pan ? "" : "PANNOTAVBL",
        name: emp?.fullName ?? "",
        tdsDeductedMinor: Math.round(agg.tds * 100),
        tdsDeducted,
        tdsDeposited: tdsDeducted, // deposited == deducted in this model
        periods: [...agg.periods].sort(),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const totalTdsDeducted = deductees.reduce((s, d) => s + d.tdsDeducted, 0);

    // Challan summary: one challan per month (TDS deposited for that month),
    // restricted to approved/disbursed runs.
    const challanRuns = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, ctx.tenantId), inArray(payrollRuns.month, months))));
    const challanValidRunIds = new Set(challanRuns.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id));
    const challanTdsRows = await scopedRead((tx) => tx.select().from(payrollTds)
      .where(and(eq(payrollTds.tenantId, ctx.tenantId), inArray(payrollTds.period, months))));
    const challans = months.map((month) => ({
      month,
      tdsDeposited: Math.round(challanTdsRows
        .filter((t) => t.period === month && (challanValidRunIds.size === 0 || challanValidRunIds.has(t.runId)))
        .reduce((s, t) => s + Number(t.tdsMinor) / 100, 0)),
    }));

    // Q4: Annexure II — salary detail per deductee (Form 16 Part B figures).
    let annexureII: Array<Record<string, unknown>> | undefined;
    if (q === "Q4") {
      annexureII = [];
      for (const d of deductees) {
        try {
          const f16 = await buildForm16(ctx.tenantId, d.employeeId, fy);
          annexureII.push({
            employeeId: d.employeeId,
            pan: f16.form16PartA.deductee.pan,
            name: f16.form16PartA.deductee.name,
            ...f16.form16PartB,
          });
        } catch (err) {
          // M4: never silently drop a deductee because HRMS is down — fail the export.
          if (err instanceof HrmsUnavailableError) {
            throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot generate Form 24Q Annexure II: HRMS identity source unreachable");
          }
          /* other errors: skip employees that genuinely cannot be built */
        }
      }
    }

    const structured = {
      formType: "24Q",
      fy,
      assessmentYear: `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`,
      quarter: q,
      deductor: employerIdentity(),
      deducteeCount: deductees.length,
      deductees,
      challanSummary: challans,
      totalTdsDeducted,
      totalTdsDeposited: challans.reduce((s, c) => s + c.tdsDeposited, 0),
      ...(annexureII ? { annexureII } : {}),
      reconciliation: {
        matched: reconciled,
        perPeriod: reconciliation,
        ...(reconciled ? {} : { warning: "FILED WITH UNRECONCILED TDS (force=1)" }),
      },
      note: reconciled
        ? "TDS deducted reconciled against deposited challans (BSR/CIN). Safe to file."
        : "WARNING: TDS deducted does NOT match deposited challans; verify BSR/CIN against TRACES before filing.",
    };

    if (format !== "file") return reply.send(structured);

    // NSDL/EPFO-style pipe-delimited flat file (RPU-like line records).
    const emp = employerIdentity();
    const lines: string[] = [];
    // File Header (FH)
    lines.push(["FH", "24Q", fy, q, pipeSafe(emp.tan), pipeSafe(emp.pan), pipeSafe(emp.name), deductees.length].join("|"));
    // Challan records (CD): batch, month, deposited amount
    challans.forEach((c, i) => {
      lines.push(["CD", i + 1, c.month, c.tdsDeposited.toFixed(2)].join("|"));
    });
    // Deductee records (DD): challan-linked deductee detail
    deductees.forEach((d, i) => {
      lines.push(["DD", i + 1, pipeSafe(d.pan || d.panFlag), pipeSafe(d.name), d.tdsDeducted.toFixed(2), d.tdsDeposited.toFixed(2)].join("|"));
    });
    if (annexureII) {
      annexureII.forEach((a, i) => {
        lines.push(["A2", i + 1, pipeSafe(a.pan), pipeSafe(a.name),
          Number(a.grossSalary ?? 0).toFixed(2), Number(a.taxableIncome ?? 0).toFixed(2),
          Number(a.totalTaxLiability ?? 0).toFixed(2)].join("|"));
      });
    }
    // File Trailer (FT)
    lines.push(["FT", lines.length + 1, totalTdsDeducted.toFixed(2)].join("|"));

    const filename = `24Q_${fy.replace("-", "")}_${q}.txt`;
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(lines.join("\r\n"));
  });

  /**
   * GET /v1/payroll/statutory/form12ba?employeeId=X&fy=2026-27
   * Statement of perquisites under Sec 17(2).
   */
  app.get("/v1/payroll/statutory/form12ba", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { employeeId: reqEmployeeId, fy } = req.query as { employeeId?: string; fy?: string };
    // C1: a self-service employee may only read their OWN Form 12BA.
    const employeeId = enforceEmployeeOwnership(ctx, reqEmployeeId);
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2026-27)");
    const { startYear, endYear } = parseFyOr400(fy);

    const decRows = await scopedRead((tx) => tx.select().from(taxDeclarations)
      .where(and(eq(taxDeclarations.tenantId, ctx.tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, fy)))
      .limit(1));
    const dec = decRows[0] ?? null;
    const perqMinor = dec ? Number(dec.perquisitesMinor) : 0;

    let pan = ""; let name = "";
    try {
      const input = await fetchPayrollInput(ctx.tenantId, `${endYear}-03`);
      const emp = input.employees.find((e) => e.id === employeeId);
      pan = emp?.pan ?? ""; name = emp?.fullName ?? ""; // reachable + no PAN → genuine blank
    } catch (err) {
      // M4: HRMS unreachable → fail (502), don't emit a blank-identity 12BA.
      if (err instanceof HrmsUnavailableError) {
        throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot generate Form 12BA: HRMS identity source unreachable");
      }
      throw err;
    }

    void startYear;

    // P3: itemised perquisite components (Sec 17(2)) rendered per statutory 12BA line.
    const comps = await scopedRead((tx) => tx.select().from(perquisiteComponents)
      .where(and(
        eq(perquisiteComponents.tenantId, ctx.tenantId),
        eq(perquisiteComponents.employeeId, employeeId),
        eq(perquisiteComponents.fy, fy),
      )));

    let perquisites: Array<Record<string, unknown>>;
    let totalPerqMinor: number;
    let sourceNote: string;
    if (comps.length > 0) {
      perquisites = comps
        .sort((a, b) => a.nature.localeCompare(b.nature))
        .map((c, i) => ({
          sl: i + 1,
          nature: c.nature,
          description: c.description,
          valueByEmployerMinor: Number(c.valueByEmployerMinor),
          amountRecoveredMinor: Number(c.amountRecoveredMinor),
          taxableValueMinor: Number(c.taxableValueMinor),
          value: Math.round(Number(c.taxableValueMinor) / 100),
        }));
      totalPerqMinor = comps.reduce((s, c) => s + Number(c.taxableValueMinor), 0);
      sourceNote = "Per-component perquisite values (Sec 17(2)) from perquisite_components.";
    } else {
      // Fall back to the declaration aggregate when no itemised components exist.
      perquisites = [
        { sl: 1, nature: "Aggregate value of perquisites u/s 17(2)", description: "", taxableValueMinor: perqMinor, value: Math.round(perqMinor / 100) },
      ];
      totalPerqMinor = perqMinor;
      sourceNote = "Aggregate perquisite from tax declaration (no itemised components ingested).";
    }

    return reply.send({
      formType: "12BA",
      fy,
      assessmentYear: `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`,
      employer: employerIdentity(),
      employee: { employeeId, pan, name, panFlag: pan ? "" : "PANNOTAVBL" },
      perquisites,
      totalPerquisitesMinor: totalPerqMinor,
      totalPerquisites: Math.round(totalPerqMinor / 100),
      note: sourceNote,
    });
  });

  /**
   * GET /v1/payroll/statutory/nps-scf?month=2026-06[&format=file]
   * NSDL/CRA Subscriber Contribution File (SCF) for NPS-scheme employees.
   * PRAN-wise employee + employer contribution for the month.
   */
  app.get("/v1/payroll/statutory/nps-scf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STATUTORY_ROLES);

    const { month, format } = req.query as { month?: string; format?: string };
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new HttpError(400, "VALIDATION_FAILED", "month query param required in YYYY-MM format");
    }

    const npsRows = await scopedRead((tx) => tx.select().from(payrollNps)
      .where(and(eq(payrollNps.tenantId, ctx.tenantId), eq(payrollNps.period, month))));
    if (npsRows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", `No NPS records found for period ${month}`);
    }

    // M4: HRMS-unreachable must FAIL the SCF (502) rather than emit blank PRANs
    // that look like genuine PRANNOTAVBL flags.
    let master = new Map<string, PayrollInputEmployee>();
    try {
      const input = await fetchPayrollInput(ctx.tenantId, month);
      master = new Map(input.employees.map((e) => [e.id, e]));
    } catch (err) {
      if (err instanceof HrmsUnavailableError) {
        throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot generate NPS-SCF: HRMS PRAN source unreachable");
      }
      throw err;
    }

    // Dedup per employee (multiple slips per FY possible); keep latest record per employee.
    const seen = new Set<string>();
    const subscribers = npsRows
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .filter((r) => (seen.has(r.employeeId) ? false : (seen.add(r.employeeId), true)))
      .map((r) => {
        const emp = master.get(r.employeeId);
        const pran = emp?.pran ?? null;
        const empContrib = Number(r.empContribMinor) / 100;
        const erContrib = Number(r.erContribMinor) / 100;
        return {
          employeeId: r.employeeId,
          pran: pran ?? "",
          pranFlag: pran ? "" : "PRANNOTAVBL",
          name: emp?.fullName ?? "",
          employeeContributionMinor: Number(r.empContribMinor),
          employerContributionMinor: Number(r.erContribMinor),
          employeeContribution: Math.round(empContrib),
          employerContribution: Math.round(erContrib),
          totalContribution: Math.round(empContrib + erContrib),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalEmployee = subscribers.reduce((s, x) => s + x.employeeContribution, 0);
    const totalEmployer = subscribers.reduce((s, x) => s + x.employerContribution, 0);

    const structured = {
      fileType: "NPS-SCF",
      month,
      employer: employerIdentity(),
      subscriberCount: subscribers.length,
      subscribers,
      totalEmployeeContribution: totalEmployee,
      totalEmployerContribution: totalEmployer,
      totalContribution: totalEmployee + totalEmployer,
      note: "PRAN sourced from HRMS; PRANNOTAVBL flags missing registrations.",
    };

    if (format !== "file") return reply.send(structured);

    // NSDL CRA SCF-style fixed-record pipe-delimited flat file.
    const lines: string[] = [];
    // Header: record-type | file-type | month | subscriber-count
    lines.push(["H", "SCF", month, subscribers.length].join("|"));
    // Subscriber Contribution Records (SCR)
    subscribers.forEach((s, i) => {
      lines.push(["S", i + 1, pipeSafe(s.pran || s.pranFlag), pipeSafe(s.name),
        s.employeeContribution.toFixed(2), s.employerContribution.toFixed(2),
        s.totalContribution.toFixed(2)].join("|"));
    });
    // Trailer: record-type | total-records | total-employee | total-employer
    lines.push(["T", subscribers.length, totalEmployee.toFixed(2), totalEmployer.toFixed(2)].join("|"));

    const filename = `NPS_SCF_${month.replace("-", "")}.txt`;
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(lines.join("\r\n"));
  });

  /**
   * POST /v1/payroll/statutory/perquisite-components
   * Ingest/upsert an itemised perquisite component (Sec 17(2)) for a 12BA line.
   * Body: { employeeId, fy, nature, description?, valueByEmployer, amountRecovered? }
   */
  app.post("/v1/payroll/statutory/perquisite-components", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STATUTORY_ROLES);

    const b = perquisiteComponentBody.parse(req.body);
    parseFyOr400(b.fy);

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await taxCommands.upsertPerquisiteComponent(ctx, b),
    );
  });

  /**
   * GET /v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1[&format=file]
   * Quarterly e-TDS return for NON-SALARY resident payments (194C/194J/194I...).
   * Sourced from statutory.payroll_tds_nonsalary, which is populated by a
   * non-salary deduction feed (AP/vendor/rent). When empty, returns a
   * well-formed empty 26Q and flags that the feed has not populated the period.
   */
  app.get("/v1/payroll/statutory/form26q", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RETURN_FILER_ROLES);

    const { fy, quarter, format } = req.query as { fy?: string; quarter?: string; format?: string };
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2026-27)");
    const q = (quarter ?? "").toUpperCase() as Quarter;
    if (!QUARTERS.includes(q)) throw new HttpError(400, "VALIDATION_FAILED", "quarter must be one of Q1,Q2,Q3,Q4");
    const { startYear, endYear } = parseFyOr400(fy);
    const months = quarterMonths(startYear, q);

    const rows = await scopedRead((tx) => tx.select().from(payrollTdsNonSalary)
      .where(and(eq(payrollTdsNonSalary.tenantId, ctx.tenantId), inArray(payrollTdsNonSalary.period, months))));

    // Deductee-wise aggregation (one row per deductee+section).
    const byKey = new Map<string, { ref: string; name: string; pan: string; section: string; paid: bigint; tds: bigint; periods: Set<string> }>();
    for (const r of rows) {
      const k = `${r.deducteeRef}|${r.section}`;
      const e = byKey.get(k) ?? { ref: r.deducteeRef, name: r.deducteeName, pan: r.deducteePan, section: r.section, paid: 0n, tds: 0n, periods: new Set<string>() };
      e.paid += BigInt(r.paidAmountMinor);
      e.tds += BigInt(r.tdsAmountMinor);
      e.periods.add(r.period);
      byKey.set(k, e);
    }
    const deductees = [...byKey.values()].map((d) => ({
      deducteeRef: d.ref,
      name: d.name,
      pan: d.pan,
      panFlag: d.pan ? "" : "PANNOTAVBL",
      section: d.section,
      amountPaidMinor: d.paid.toString(),
      tdsDeductedMinor: d.tds.toString(),
      periods: [...d.periods].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name) || a.section.localeCompare(b.section));

    const totalTdsMinor = [...byKey.values()].reduce((s, d) => s + d.tds, 0n);

    // Reconcile against 26Q challans for the quarter.
    const challanReco: Reconciliation[] = [];
    for (const mo of months) challanReco.push(await reconcileNonSalaryPeriod(ctx.tenantId, mo));

    const structured = {
      formType: "26Q",
      fy,
      assessmentYear: `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`,
      quarter: q,
      deductor: employerIdentity(),
      deducteeCount: deductees.length,
      deductees,
      totalTdsDeductedMinor: totalTdsMinor.toString(),
      reconciliation: { perPeriod: challanReco, matched: challanReco.every((r) => r.matched || r.status === "no_challan") },
      populated: rows.length > 0,
      note: rows.length > 0
        ? "Non-salary TDS sourced from payroll_tds_nonsalary. Verify challan BSR/CIN against TRACES before filing."
        : "No non-salary TDS for this period. Population requires a non-salary deduction feed (AP/vendor/rent) writing to statutory.payroll_tds_nonsalary.",
    };

    if (format !== "file") return reply.send(structured);

    const emp = employerIdentity();
    const lines: string[] = [];
    lines.push(["FH", "26Q", fy, q, pipeSafe(emp.tan), pipeSafe(emp.pan), pipeSafe(emp.name), deductees.length].join("|"));
    deductees.forEach((d, i) => {
      lines.push(["DD", i + 1, pipeSafe(d.pan || d.panFlag), pipeSafe(d.name), pipeSafe(d.section),
        (Number(d.amountPaidMinor) / 100).toFixed(2), (Number(d.tdsDeductedMinor) / 100).toFixed(2)].join("|"));
    });
    lines.push(["FT", lines.length + 1, (Number(totalTdsMinor) / 100).toFixed(2)].join("|"));
    const filename = `26Q_${fy.replace("-", "")}_${q}.txt`;
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(lines.join("\r\n"));
  });
}

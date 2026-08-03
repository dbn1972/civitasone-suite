import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { payrollTdsChallan, payrollTds, payrollTdsNonSalary } from "../statutory/schema.js";
import { payrollRuns } from "../payroll/schema.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as challanCommands from "./challan-commands.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const FILER_ROLES = [...STATUTORY_ROLES, "hr_admin", "finance_officer"];

/** YYYY-MM guard. */
const isPeriod = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

const challanBodySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "period required (YYYY-MM)"),
  bsrCode: z.string().regex(/^\d{7}$/, "bsrCode must be a 7-digit RBI BSR code"),
  challanSerial: z.string().min(1, "challanSerial required"),
  depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "depositDate required (YYYY-MM-DD)"),
  section: z.string().max(8).optional(),
  formType: z.enum(["24Q", "26Q"]).optional(),
  tdsAmount: z.number().finite().nonnegative(),
  totalAmount: z.number().finite().nonnegative().optional(),
  interest: z.number().finite().nonnegative().optional(),
  fee: z.number().finite().nonnegative().optional(),
});

/**
 * Sum of TDS DEDUCTED (payroll_tds) for a tenant+period, restricted to
 * approved/disbursed runs (the same finalised-run rule as Form 16 / 24Q).
 * Returns paise.
 */
async function tdsDeductedMinor(tenantId: string, period: string): Promise<bigint> {
  const runs = await scopedRead((tx) => tx.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.month, period))));
  const valid = new Set(runs.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id));
  const rows = await scopedRead((tx) => tx.select().from(payrollTds)
    .where(and(eq(payrollTds.tenantId, tenantId), eq(payrollTds.period, period))));
  let sum = 0n;
  for (const t of rows) {
    if (valid.size > 0 && !valid.has(t.runId)) continue;
    sum += BigInt(t.tdsMinor);
  }
  return sum;
}

/** Sum of TDS DEPOSITED via challans for a tenant+period+formType. Returns paise. */
async function tdsDepositedMinor(tenantId: string, period: string, formType: string): Promise<bigint> {
  const rows = await scopedRead((tx) => tx.select().from(payrollTdsChallan)
    .where(and(
      eq(payrollTdsChallan.tenantId, tenantId),
      eq(payrollTdsChallan.period, period),
      eq(payrollTdsChallan.formType, formType),
    )));
  return rows.reduce((s, c) => s + BigInt(c.tdsAmountMinor), 0n);
}

/**
 * H2: true when a payroll run exists for the period but is NOT yet finalised
 * (draft/processing/failed). Such a period has deducted==0 only because the run
 * has not produced/approved its TDS rows yet — it is NOT "no liability". The 24Q
 * gate must block it (pending_finalisation) rather than green-light it as matched.
 */
async function hasNonFinalRun(tenantId: string, period: string): Promise<boolean> {
  const runs = await scopedRead((tx) => tx.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.month, period))));
  return runs.some((r) => r.status === "draft" || r.status === "processing" || r.status === "failed");
}

export interface Reconciliation {
  tenantId: string;
  period: string;
  formType: string;
  tdsDeductedMinor: string;
  tdsDepositedMinor: string;
  varianceMinor: string;   // deposited - deducted
  matched: boolean;
  challanCount: number;
  status: "matched" | "shortfall" | "excess" | "no_challan" | "pending_finalisation";
}

/** Reconcile deducted vs deposited for a period. Pure-ish helper reused by 24Q gating. */
export async function reconcilePeriod(tenantId: string, period: string, formType = "24Q"): Promise<Reconciliation> {
  const deducted = await tdsDeductedMinor(tenantId, period);
  const deposited = await tdsDepositedMinor(tenantId, period, formType);
  const pendingFinalisation = await hasNonFinalRun(tenantId, period);
  const challans = await scopedRead((tx) => tx.select().from(payrollTdsChallan)
    .where(and(
      eq(payrollTdsChallan.tenantId, tenantId),
      eq(payrollTdsChallan.period, period),
      eq(payrollTdsChallan.formType, formType),
    )));
  const variance = deposited - deducted;
  // H2: a period with a non-finalised run (draft/processing/failed) has
  // deducted==0 only because TDS is not approved yet — that is NOT "no
  // liability". Surface it as pending_finalisation and do NOT mark it matched,
  // so the 24Q gate blocks it.
  let status: Reconciliation["status"];
  let matched: boolean;
  if (pendingFinalisation) {
    status = "pending_finalisation";
    matched = false;
  } else if (deducted === 0n && deposited === 0n) {
    // No liability and no in-flight run: reconciled by definition.
    status = "matched"; matched = true;
  } else if (challans.length === 0) {
    status = "no_challan"; matched = false;
  } else if (variance === 0n) {
    status = "matched"; matched = true;
  } else if (variance < 0n) {
    status = "shortfall"; matched = false;
  } else {
    status = "excess"; matched = false;
  }
  return {
    tenantId, period, formType,
    tdsDeductedMinor: deducted.toString(),
    tdsDepositedMinor: deposited.toString(),
    varianceMinor: variance.toString(),
    matched,
    challanCount: challans.length,
    status,
  };
}

/** Sum of NON-SALARY TDS deducted (payroll_tds_nonsalary) for a period. Paise. */
async function nonSalaryDeductedMinor(tenantId: string, period: string): Promise<bigint> {
  const rows = await scopedRead((tx) => tx.select().from(payrollTdsNonSalary)
    .where(and(eq(payrollTdsNonSalary.tenantId, tenantId), eq(payrollTdsNonSalary.period, period))));
  return rows.reduce((s, r) => s + BigInt(r.tdsAmountMinor), 0n);
}

/** Reconcile NON-SALARY (26Q) TDS deducted vs deposited (26Q challans) for a period. */
export async function reconcileNonSalaryPeriod(tenantId: string, period: string): Promise<Reconciliation> {
  const deducted = await nonSalaryDeductedMinor(tenantId, period);
  const deposited = await tdsDepositedMinor(tenantId, period, "26Q");
  const pendingFinalisation = await hasNonFinalRun(tenantId, period);
  const challans = await scopedRead((tx) => tx.select().from(payrollTdsChallan)
    .where(and(
      eq(payrollTdsChallan.tenantId, tenantId),
      eq(payrollTdsChallan.period, period),
      eq(payrollTdsChallan.formType, "26Q"),
    )));
  const variance = deposited - deducted;
  let status: Reconciliation["status"];
  let matched: boolean;
  if (pendingFinalisation) {
    status = "pending_finalisation"; matched = false;
  } else if (deducted === 0n && deposited === 0n) {
    status = "matched"; matched = true;
  } else if (challans.length === 0) {
    status = "no_challan"; matched = false;
  } else if (variance === 0n) {
    status = "matched"; matched = true;
  } else if (variance < 0n) {
    status = "shortfall"; matched = false;
  } else {
    status = "excess"; matched = false;
  }
  return {
    tenantId, period, formType: "26Q",
    tdsDeductedMinor: deducted.toString(),
    tdsDepositedMinor: deposited.toString(),
    varianceMinor: variance.toString(),
    matched,
    challanCount: challans.length,
    status,
  };
}

export async function challanRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/payroll/statutory/challans
   * Ingest a TDS challan (BSR code, serial, deposit date, amount). CIN is
   * derived (BSR + DDMMYYYY + 5-digit serial) and used as the idempotency key.
   * CQRS: validate → publish → 202.
   */
  app.post("/v1/payroll/statutory/challans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FILER_ROLES);

    const b = challanBodySchema.parse(req.body);
    const formType = b.formType === "26Q" ? "26Q" : "24Q";
    const section = b.section ?? (formType === "26Q" ? "194" : "192");
    // CIN = BSR(7) + DDMMYYYY(8) + serial padded to 5.
    const [yy, mm, dd] = b.depositDate.split("-");
    const ddmmyyyy = `${dd}${mm}${yy}`;
    const serial5 = b.challanSerial.replace(/\D/g, "").padStart(5, "0").slice(-5);
    const cin = `${b.bsrCode}${ddmmyyyy}${serial5}`;

    const paise = (v?: number): bigint => BigInt(Math.round((v ?? 0) * 100));
    const tdsMinor = paise(b.tdsAmount);
    const totalMinor = b.totalAmount != null ? paise(b.totalAmount) : tdsMinor + paise(b.interest) + paise(b.fee);

    return sendAccepted(reply, acceptedResponseSchema, await challanCommands.ingestChallan(ctx, {
      period: b.period,
      bsrCode: b.bsrCode,
      challanSerial: b.challanSerial,
      depositDate: b.depositDate,
      section,
      formType,
      cin,
      tdsAmountMinor: tdsMinor.toString(),
      totalAmountMinor: totalMinor.toString(),
      interestMinor: paise(b.interest).toString(),
      feeMinor: paise(b.fee).toString(),
    }));
  });

  /**
   * GET /v1/payroll/statutory/challans?period=YYYY-MM[&formType=24Q]
   * List ingested challans for a period.
   */
  app.get("/v1/payroll/statutory/challans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FILER_ROLES);
    const { period, formType } = req.query as { period?: string; formType?: string };
    if (!isPeriod(period)) throw new HttpError(400, "VALIDATION_FAILED", "period required (YYYY-MM)");
    const ft = formType === "26Q" ? "26Q" : "24Q";
    const rows = await scopedRead((tx) => tx.select().from(payrollTdsChallan)
      .where(and(
        eq(payrollTdsChallan.tenantId, ctx.tenantId),
        eq(payrollTdsChallan.period, period),
        eq(payrollTdsChallan.formType, ft),
      )));
    return reply.send({
      period, formType: ft, count: rows.length,
      challans: rows.map((c) => ({
        cin: c.cin, bsrCode: c.bsrCode, challanSerial: c.challanSerial,
        depositDate: c.depositDate, section: c.section,
        tdsAmountMinor: String(c.tdsAmountMinor), totalAmountMinor: String(c.totalAmountMinor),
        status: c.status,
      })),
    });
  });

  /**
   * GET /v1/payroll/statutory/reconcile?fy=2026-27&quarter=Q1   (or &period=YYYY-MM)
   * Reconcile TDS deducted (payroll_tds, finalised runs) vs deposited (challans).
   */
  app.get("/v1/payroll/statutory/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FILER_ROLES);
    const { period, fy, quarter, formType } = req.query as { period?: string; fy?: string; quarter?: string; formType?: string };
    const ft = formType === "26Q" ? "26Q" : "24Q";

    let months: string[];
    if (isPeriod(period)) {
      months = [period];
    } else if (fy && quarter) {
      const m = /^(\d{4})-(\d{2})$/.exec(fy);
      if (!m) throw new HttpError(400, "VALIDATION_FAILED", "fy must be YYYY-YY");
      const sy = parseInt(m[1]!, 10);
      const qmap: Record<string, Array<[number, number]>> = {
        Q1: [[0, 4], [0, 5], [0, 6]], Q2: [[0, 7], [0, 8], [0, 9]],
        Q3: [[0, 10], [0, 11], [0, 12]], Q4: [[1, 1], [1, 2], [1, 3]],
      };
      const q = quarter.toUpperCase();
      const spec = qmap[q];
      if (!spec) throw new HttpError(400, "VALIDATION_FAILED", "quarter must be Q1..Q4");
      months = spec.map(([off, mm]) => `${sy + off}-${String(mm).padStart(2, "0")}`);
    } else {
      throw new HttpError(400, "VALIDATION_FAILED", "provide period=YYYY-MM or fy+quarter");
    }

    const perPeriod: Reconciliation[] = [];
    for (const mo of months) perPeriod.push(await reconcilePeriod(ctx.tenantId, mo, ft));

    const sumStr = (k: keyof Reconciliation) =>
      perPeriod.reduce((s, r) => s + BigInt(r[k] as string), 0n).toString();
    const totalDeducted = sumStr("tdsDeductedMinor");
    const totalDeposited = sumStr("tdsDepositedMinor");
    const variance = (BigInt(totalDeposited) - BigInt(totalDeducted));
    const allMatched = perPeriod.every((r) => r.matched);

    return reply.send({
      formType: ft,
      ...(isPeriod(period) ? { period } : { fy, quarter: (quarter ?? "").toUpperCase() }),
      perPeriod,
      totalDeductedMinor: totalDeducted,
      totalDepositedMinor: totalDeposited,
      varianceMinor: variance.toString(),
      matched: allMatched,
      filingBlocked: !allMatched,
      note: allMatched
        ? "TDS deducted equals deposited; 24Q may be filed."
        : "TDS deducted does NOT match deposited challans; resolve before filing 24Q.",
    });
  });
}

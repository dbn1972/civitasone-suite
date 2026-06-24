import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollTdsChallan, payrollTds, payrollTdsNonSalary } from "../statutory/schema.js";
import { payrollRuns } from "../payroll/schema.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const FILER_ROLES = [...STATUTORY_ROLES, "hr_admin", "finance_officer"];

/** YYYY-MM guard. */
const isPeriod = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

/**
 * Sum of TDS DEDUCTED (payroll_tds) for a tenant+period, restricted to
 * approved/disbursed runs (the same finalised-run rule as Form 16 / 24Q).
 * Returns paise.
 */
async function tdsDeductedMinor(tenantId: string, period: string): Promise<bigint> {
  const runs = await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.month, period)));
  const valid = new Set(runs.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id));
  const rows = await db.select().from(payrollTds)
    .where(and(eq(payrollTds.tenantId, tenantId), eq(payrollTds.period, period)));
  let sum = 0n;
  for (const t of rows) {
    if (valid.size > 0 && !valid.has(t.runId)) continue;
    sum += BigInt(t.tdsMinor);
  }
  return sum;
}

/** Sum of TDS DEPOSITED via challans for a tenant+period+formType. Returns paise. */
async function tdsDepositedMinor(tenantId: string, period: string, formType: string): Promise<bigint> {
  const rows = await db.select().from(payrollTdsChallan)
    .where(and(
      eq(payrollTdsChallan.tenantId, tenantId),
      eq(payrollTdsChallan.period, period),
      eq(payrollTdsChallan.formType, formType),
    ));
  return rows.reduce((s, c) => s + BigInt(c.tdsAmountMinor), 0n);
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
  status: "matched" | "shortfall" | "excess" | "no_challan";
}

/** Reconcile deducted vs deposited for a period. Pure-ish helper reused by 24Q gating. */
export async function reconcilePeriod(tenantId: string, period: string, formType = "24Q"): Promise<Reconciliation> {
  const deducted = await tdsDeductedMinor(tenantId, period);
  const deposited = await tdsDepositedMinor(tenantId, period, formType);
  const challans = await db.select().from(payrollTdsChallan)
    .where(and(
      eq(payrollTdsChallan.tenantId, tenantId),
      eq(payrollTdsChallan.period, period),
      eq(payrollTdsChallan.formType, formType),
    ));
  const variance = deposited - deducted;
  // A period with no TDS liability (nothing deducted, nothing to deposit) is
  // reconciled by definition — it must not block 24Q filing.
  const matched = variance === 0n;
  let status: Reconciliation["status"];
  if (deducted === 0n && deposited === 0n) status = "matched";
  else if (challans.length === 0) status = "no_challan";
  else if (variance === 0n) status = "matched";
  else if (variance < 0n) status = "shortfall";
  else status = "excess";
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
  const rows = await db.select().from(payrollTdsNonSalary)
    .where(and(eq(payrollTdsNonSalary.tenantId, tenantId), eq(payrollTdsNonSalary.period, period)));
  return rows.reduce((s, r) => s + BigInt(r.tdsAmountMinor), 0n);
}

/** Reconcile NON-SALARY (26Q) TDS deducted vs deposited (26Q challans) for a period. */
export async function reconcileNonSalaryPeriod(tenantId: string, period: string): Promise<Reconciliation> {
  const deducted = await nonSalaryDeductedMinor(tenantId, period);
  const deposited = await tdsDepositedMinor(tenantId, period, "26Q");
  const challans = await db.select().from(payrollTdsChallan)
    .where(and(
      eq(payrollTdsChallan.tenantId, tenantId),
      eq(payrollTdsChallan.period, period),
      eq(payrollTdsChallan.formType, "26Q"),
    ));
  const variance = deposited - deducted;
  const matched = variance === 0n;
  let status: Reconciliation["status"];
  if (deducted === 0n && deposited === 0n) status = "matched";
  else if (challans.length === 0) status = "no_challan";
  else if (variance === 0n) status = "matched";
  else if (variance < 0n) status = "shortfall";
  else status = "excess";
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
   */
  app.post("/v1/payroll/statutory/challans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FILER_ROLES);

    const b = req.body as {
      period?: string; bsrCode?: string; challanSerial?: string; depositDate?: string;
      section?: string; formType?: string;
      tdsAmount?: number; totalAmount?: number; interest?: number; fee?: number;
    };
    if (!isPeriod(b.period)) throw new HttpError(400, "VALIDATION_FAILED", "period required (YYYY-MM)");
    if (!b.bsrCode || !/^\d{7}$/.test(b.bsrCode)) throw new HttpError(400, "VALIDATION_FAILED", "bsrCode must be a 7-digit RBI BSR code");
    if (!b.challanSerial) throw new HttpError(400, "VALIDATION_FAILED", "challanSerial required");
    if (!b.depositDate || !/^\d{4}-\d{2}-\d{2}$/.test(b.depositDate)) throw new HttpError(400, "VALIDATION_FAILED", "depositDate required (YYYY-MM-DD)");
    if (b.tdsAmount == null || b.tdsAmount < 0) throw new HttpError(400, "VALIDATION_FAILED", "tdsAmount (rupees) required");

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

    const inserted = await db.insert(payrollTdsChallan).values({
      tenantId: ctx.tenantId,
      period: b.period,
      section,
      formType,
      bsrCode: b.bsrCode,
      challanSerial: b.challanSerial,
      depositDate: b.depositDate,
      cin,
      tdsAmountMinor: tdsMinor,
      totalAmountMinor: totalMinor,
      interestMinor: paise(b.interest),
      feeMinor: paise(b.fee),
      createdBy: ctx.actorId,
    }).onConflictDoNothing({ target: [payrollTdsChallan.tenantId, payrollTdsChallan.cin] }).returning();

    const idempotent = inserted.length === 0;
    return reply.code(idempotent ? 200 : 201).send({
      message: idempotent ? "challan already ingested (idempotent)" : "challan ingested",
      cin,
      period: b.period,
      formType,
      tdsAmountMinor: tdsMinor.toString(),
    });
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
    const rows = await db.select().from(payrollTdsChallan)
      .where(and(
        eq(payrollTdsChallan.tenantId, ctx.tenantId),
        eq(payrollTdsChallan.period, period),
        eq(payrollTdsChallan.formType, ft),
      ));
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

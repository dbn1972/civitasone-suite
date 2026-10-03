/**
 * GAP-PAYROLL-TAX-DECLARATION-02: declared vs VERIFIED deduction inputs.
 *
 * Standard employer TDS practice: until the tenant's proof-submission cutoff
 * for the FY, TDS projection uses the amounts the employee DECLARED (as it
 * always has). After the cutoff, every deduction that needs proof (80C, 80D,
 * other / 80G / home-loan interest, rent for HRA) uses only the VERIFIED
 * amount: the sum of ACCEPTED proofs, capped at the declared amount. Pending,
 * rejected and absent proofs count as zero. The statutory limits (80C / 80D
 * caps) are applied downstream by the unchanged engine, so the effective
 * figure is min(verified, declared, statutory limit).
 *
 * This module only SELECTS which input the engine reads; slab and limit maths
 * are untouched. The cutoff is a per-tenant setting (payroll_settings
 * .tax_proof_cutoff_md, "MM-DD", default 01-31 = 31 January of the FY).
 */
import { sql } from "drizzle-orm";

export const DEFAULT_PROOF_CUTOFF_MD = "01-31";

/** Declaration lines whose figures need proof, and the proof lines that feed each. */
export interface DeductionFigures {
  section80c: bigint;
  section80d: bigint;
  otherDeductions: bigint;
  rentPaidMinor: bigint;
  hraClaimed: bigint;
}

export interface VerifiedFigures {
  sec80c: bigint;
  sec80d: bigint;
  /** other + 80G + home-loan interest proofs (all land in the declaration's "other deductions"). */
  other: bigint;
  rent: bigint;
}

export const NO_VERIFIED: VerifiedFigures = { sec80c: 0n, sec80d: 0n, other: 0n, rent: 0n };

const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "MM-DD" that exists on some calendar (02-29 allowed). */
export function isValidCutoffMd(md: string): boolean {
  const m = MD_RE.exec(md);
  if (!m) return false;
  return Number(m[2]) <= DAYS_IN_MONTH[Number(m[1]) - 1]!;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar date (YYYY-MM-DD) of the cutoff inside financial year `fy` ("2025-26"): Apr-Dec fall in the start year, Jan-Mar in the next. */
export function cutoffDate(fy: string, md: string): string | null {
  const f = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!f || !isValidCutoffMd(md)) return null;
  const month = Number(md.slice(0, 2));
  const year = month >= 4 ? Number(f[1]) : Number(f[1]) + 1;
  const day = Math.min(Number(md.slice(3)), daysIn(year, month)); // 02-29 in a non-leap year -> 02-28
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** True once `asOf` (YYYY-MM-DD) is strictly after the cutoff date: the cutoff day itself is still "before". */
export function proofCutoffPassed(fy: string, md: string, asOf: string): boolean {
  const c = cutoffDate(fy, md);
  return c !== null && asOf > c;
}

/** Today's calendar date in Asia/Kolkata (UTC+05:30, no DST). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/**
 * HRA exemption after verification. When verified rent covers the declared
 * rent nothing changes. Otherwise the exemption falls by the unverified rent
 * (exact when the rent term "rent - 10% of salary" is the binding limb of the
 * least-of-three; never over-exempts otherwise). Zero verified rent -> zero.
 */
export function hraAfterVerifiedRent(hraClaimed: bigint, declaredRent: bigint, verifiedRent: bigint): bigint {
  const v = min(verifiedRent, declaredRent);
  if (v >= declaredRent) return hraClaimed;
  if (v <= 0n) return 0n;
  const reduced = hraClaimed - (declaredRent - v);
  return reduced > 0n ? reduced : 0n;
}

/** Declared figures -> the figures the engine should read once the cutoff has passed. */
export function verifiedDeductionFigures(declared: DeductionFigures, verified: VerifiedFigures): DeductionFigures {
  const rent = min(verified.rent, declared.rentPaidMinor);
  return {
    section80c: min(verified.sec80c, declared.section80c),
    section80d: min(verified.sec80d, declared.section80d),
    otherDeductions: min(verified.other, declared.otherDeductions),
    rentPaidMinor: rent,
    hraClaimed: hraAfterVerifiedRent(declared.hraClaimed, declared.rentPaidMinor, rent),
  };
}

type TxLike = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> => Array.from(r as Iterable<Record<string, unknown>>);

export interface ProofSettings {
  /** Cutoff "MM-DD" (default 01-31). */
  cutoffMd: string;
  /** First FY (e.g. "2026-27") for which verified-only TDS applies; null = OFF (the default for every tenant). */
  verifiedFromFy: string | null;
}

/** "YYYY-YY" whose suffix is startYear+1 (mod 100). */
export function isValidFy(fy: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && Number(m[2]) === (Number(m[1]) + 1) % 100;
}

export async function loadProofSettings(tx: TxLike, tenantId: string): Promise<ProofSettings> {
  const r = rowsOf(await tx.execute(sql`
    SELECT tax_proof_cutoff_md AS md, tax_proof_verified_from_fy AS from_fy FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid
  `))[0];
  const md = r ? String(r.md) : DEFAULT_PROOF_CUTOFF_MD;
  const from = r && r.from_fy ? String(r.from_fy) : null;
  return { cutoffMd: isValidCutoffMd(md) ? md : DEFAULT_PROOF_CUTOFF_MD, verifiedFromFy: from && isValidFy(from) ? from : null };
}

/** The tenant's cutoff ("MM-DD"); the default when no setting row exists. */
export async function loadProofCutoffMd(tx: TxLike, tenantId: string): Promise<string> {
  return (await loadProofSettings(tx, tenantId)).cutoffMd;
}

/** Whether verified-only TDS is switched on for `fy` (flag set and fy >= flag); says nothing about the cutoff date. */
export function verifiedTdsEnabledFor(settings: ProofSettings, fy: string): boolean {
  return settings.verifiedFromFy !== null && fy >= settings.verifiedFromFy;
}

/** Sum of ACCEPTED proofs per employee and declaration line for the FY. `employeeIds` null = every employee in the tenant. */
export async function loadVerifiedFigures(
  tx: TxLike, tenantId: string, fy: string, employeeIds: readonly string[] | null,
): Promise<Map<string, VerifiedFigures>> {
  const out = new Map<string, VerifiedFigures>();
  if (employeeIds !== null && employeeIds.length < 1) return out;
  const filter = employeeIds === null
    ? sql``
    : sql`AND employee_id = ANY(ARRAY[${sql.join(employeeIds.map((id) => sql`${id}::uuid`), sql`, `)}])`;
  const rows = rowsOf(await tx.execute(sql`
    SELECT employee_id::text AS employee_id, line, COALESCE(SUM(amount_minor), 0)::text AS total
      FROM payroll.tax_proofs
     WHERE tenant_id = ${tenantId}::uuid AND fy = ${fy} AND status = 'accepted' ${filter}
     GROUP BY employee_id, line
  `));
  for (const r of rows) {
    const id = String(r.employee_id);
    const cur = out.get(id) ?? { ...NO_VERIFIED };
    const total = BigInt(String(r.total));
    switch (String(r.line)) {
      case "sec80c": cur.sec80c += total; break;
      case "sec80d": cur.sec80d += total; break;
      case "rent": cur.rent += total; break;
      default: cur.other += total; // other, sec80g, home_loan_interest
    }
    out.set(id, cur);
  }
  return out;
}

export interface VerificationPlan {
  /** True when the cutoff has passed: callers must substitute verified figures. */
  apply: boolean;
  verified: Map<string, VerifiedFigures>;
}

/**
 * One call per read site. Verified-only applies ONLY when ALL hold: the tenant
 * opted in (verifiedFromFy set), fy >= verifiedFromFy, and the proof cutoff has
 * passed. Otherwise {apply:false}: callers keep the declared figures untouched
 * (so existing tenants and closed FYs are unchanged on deploy).
 */
export async function resolveVerificationPlan(
  tx: TxLike, tenantId: string, fy: string, asOf: string, employeeIds: readonly string[] | null,
): Promise<VerificationPlan> {
  const settings = await loadProofSettings(tx, tenantId);
  if (!verifiedTdsEnabledFor(settings, fy) || !proofCutoffPassed(fy, settings.cutoffMd, asOf)) {
    return { apply: false, verified: new Map() };
  }
  return { apply: true, verified: await loadVerifiedFigures(tx, tenantId, fy, employeeIds) };
}

/** Recomputes the Sec 10(13A) exemption for a (verified) annual rent: the payroll engine's own least-of-three. */
export type HraRecompute = (employeeId: string, rentPaidMinor: bigint) => Promise<bigint>;

/**
 * Row adapter for the drizzle declaration rows several read sites use. After
 * verification the HRA exemption is RECOMPUTED from the verified rent with the
 * same function the declaration consumer uses (so Form 16 and the computation
 * match the payroll engine). Only if that recomputation is unavailable (e.g.
 * HRMS down) does it fall back to the conservative subtraction bound.
 */
export async function applyPlanToRowExact<T extends { employeeId: string; regime: string; section80c: bigint; section80d: bigint; otherDeductions: bigint; rentPaidMinor: bigint; hraClaimed: bigint }>(
  plan: VerificationPlan, row: T, recompute: HraRecompute,
): Promise<T> {
  if (!plan.apply) return row;
  const f = verifiedDeductionFigures(row, plan.verified.get(row.employeeId) ?? NO_VERIFIED);
  let hra = f.hraClaimed; // conservative bound, also the fallback
  const fullyVerified = f.rentPaidMinor >= row.rentPaidMinor;
  if (row.regime === "old" && !fullyVerified && f.rentPaidMinor > 0n) {
    try { hra = await recompute(row.employeeId, f.rentPaidMinor); } catch { /* keep the conservative bound */ }
  }
  return { ...row, ...f, hraClaimed: hra };
}

/** Synchronous adapter (conservative HRA bound) for callers with no HRMS access. */
export function applyPlanToRow<T extends { employeeId: string; section80c: bigint; section80d: bigint; otherDeductions: bigint; rentPaidMinor: bigint; hraClaimed: bigint }>(
  plan: VerificationPlan, row: T,
): T {
  if (!plan.apply) return row;
  const f = verifiedDeductionFigures(row, plan.verified.get(row.employeeId) ?? NO_VERIFIED);
  return { ...row, ...f };
}

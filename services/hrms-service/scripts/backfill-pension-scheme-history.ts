/**
 * UAT b18 (ERP-head decision 2026-11-05, PR #2458): back-fill the pension
 * scheme history (employee.hrms_pension_scheme_changes, migration 0261) for
 * employees whose recorded scheme has NO history row, so the payroll-input feed
 * and the audit trail have a starting point.
 *
 *   - default: one "initial" row per such employee -- from = to = the recorded
 *     scheme, effective the 1st of the joining month. It changes no period
 *     (the scheme in effect stays the recorded one).
 *   - --correction <employeeNo>=<FROM>:<YYYY-MM-01>: instead, a "correction" row
 *     for a switch made outside the change API: FROM -> the recorded scheme,
 *     effective that date (months before it keep FROM). Needs --reason.
 *     The UAT 2026-11-05 SQL switch of the 6 contract staff (NPS -> EPF, first
 *     EPF period 2027-02):
 *       --correction UATG1-25595=NPS:2027-02-01 --correction UATG1-37007=NPS:2027-02-01
 *       --correction UATG1-71359=NPS:2027-02-01 --correction UATG1-34944=NPS:2027-02-01
 *       --correction UATG1-48782=NPS:2027-02-01 --correction UATG1-97489=NPS:2027-02-01
 *       --reason "UAT data correction 2026-11-05 (owner-approved switch to EPF)"
 *
 * Rows are written approved and applied (the scheme already is on record),
 * requested by the system actor and decided by --actor (the approving
 * officer's user id, required with --apply), each audited
 * (pension_scheme_history_backfill). hrms_employees is never changed.
 * Idempotent: an employee who has any history row is skipped (re-checked under
 * a row lock at write time), so a second --apply writes nothing.
 *
 *   --dry-run (DEFAULT): report what would be written; writes nothing.
 *   --apply            : write the rows.
 *   --tenant <uuid>    : only this tenant (repeatable); default every tenant.
 *
 * Usage (from services/hrms-service, with the hrms-service runtime env):
 *   pnpm exec tsx scripts/backfill-pension-scheme-history.ts --tenant <uuid> [--correction ...] [--reason ...]
 *   pnpm exec tsx scripts/backfill-pension-scheme-history.ts --apply --actor <uuid> --tenant <uuid> ...
 * Prints one JSON report line (employee ids / numbers and schemes only).
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient, scopedPlatformRead } from "../src/shared/db.js";
import { enqueue } from "../src/shared/outbox.js";
import * as employeeRepo from "../src/modules/employee/repo.js";
import { hrmsEmployees, hrmsPensionSchemeChanges } from "../src/modules/employee/schema.js";
import { PENSION_SCHEMES } from "../src/modules/employee/pension-scheme.js";

export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
export const INITIAL_REASON = "Initial pension scheme recorded by the history backfill (scheme on record, no change)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIRST_OF_MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export interface Correction { fromScheme: string; effectiveFrom: string }
export interface BackfillArgs { dryRun: boolean; tenants: string[]; actor: string | null; corrections: Map<string, Correction>; reason: string | null }
export interface EmployeeLite { id: string; employeeNo: string; pensionScheme: string; dateOfJoining: string }
export interface PlannedRow { employeeId: string; employeeNo: string; kind: "initial" | "correction"; fromScheme: string; toScheme: string; effectiveFrom: string; reason: string }

export function parseArgs(argv: string[]): BackfillArgs {
  let apply = false, dry = false, actor: string | null = null, reason: string | null = null;
  const tenants: string[] = [];
  const corrections = new Map<string, Correction>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") dry = true;
    else if (a === "--tenant") {
      const v = argv[++i];
      if (!v || !UUID_RE.test(v)) throw new Error("--tenant needs a tenant uuid");
      tenants.push(v);
    } else if (a === "--actor") {
      const v = argv[++i];
      if (!v || !UUID_RE.test(v)) throw new Error("--actor needs the approving user uuid");
      actor = v;
    } else if (a === "--reason") {
      const v = (argv[++i] ?? "").trim();
      if (v.length < 10) throw new Error("--reason needs at least 10 characters");
      reason = v;
    } else if (a === "--correction") {
      const m = /^([^=]+)=([A-Z]{3}):(\d{4}-\d{2}-\d{2})$/.exec(argv[++i] ?? "");
      if (!m || !FIRST_OF_MONTH.test(m[3]!)) throw new Error("--correction needs <employeeNo>=<FROM>:<YYYY-MM-01>");
      corrections.set(m[1]!, { fromScheme: m[2]!, effectiveFrom: m[3]! });
    } else throw new Error(`unknown argument ${a} (use --dry-run | --apply | --tenant <uuid> | --actor <uuid> | --correction <no>=<FROM>:<date> | --reason <text>)`);
  }
  if (apply && dry) throw new Error("--apply and --dry-run are mutually exclusive");
  if (corrections.size > 0 && !reason) throw new Error("--correction needs --reason");
  if (apply && !actor) throw new Error("--apply needs --actor <approving user uuid>");
  return { dryRun: !apply, tenants, actor, corrections, reason };
}

/**
 * Pure: the rows to write for one tenant, and why anything is skipped.
 * `withHistory`: employees that already have at least one history row.
 */
export function planBackfill(
  employees: readonly EmployeeLite[], withHistory: ReadonlySet<string>,
  corrections: ReadonlyMap<string, Correction>, reason: string | null,
): { rows: PlannedRow[]; skipped: Array<{ employeeNo: string; reason: string }> } {
  const rows: PlannedRow[] = [];
  const skipped: Array<{ employeeNo: string; reason: string }> = [];
  for (const e of employees) {
    if (withHistory.has(e.id)) { if (corrections.has(e.employeeNo)) skipped.push({ employeeNo: e.employeeNo, reason: "already has pension scheme history" }); continue; }
    const joinMonth = `${e.dateOfJoining.slice(0, 7)}-01`;
    const c = corrections.get(e.employeeNo);
    if (c) {
      if (!(PENSION_SCHEMES as readonly string[]).includes(e.pensionScheme) && e.pensionScheme !== "CPF") { skipped.push({ employeeNo: e.employeeNo, reason: `unknown recorded scheme ${e.pensionScheme}` }); continue; }
      if (c.fromScheme === e.pensionScheme) { skipped.push({ employeeNo: e.employeeNo, reason: `correction from ${c.fromScheme} equals the recorded scheme` }); continue; }
      if (c.effectiveFrom < joinMonth) { skipped.push({ employeeNo: e.employeeNo, reason: `correction effective ${c.effectiveFrom} is before the joining month` }); continue; }
      rows.push({ employeeId: e.id, employeeNo: e.employeeNo, kind: "correction", fromScheme: c.fromScheme, toScheme: e.pensionScheme, effectiveFrom: c.effectiveFrom, reason: reason! });
    } else {
      rows.push({ employeeId: e.id, employeeNo: e.employeeNo, kind: "initial", fromScheme: e.pensionScheme, toScheme: e.pensionScheme, effectiveFrom: joinMonth, reason: INITIAL_REASON });
    }
  }
  const seen = new Set(employees.map((e) => e.employeeNo));
  for (const no of corrections.keys()) if (!seen.has(no)) skipped.push({ employeeNo: no, reason: "employee not found in this tenant" });
  return { rows, skipped };
}

export interface BackfillReport {
  dryRun: boolean;
  tenants: number;
  planned: Array<PlannedRow & { tenantId: string }>;
  written: number;
  skipped: Array<{ tenantId: string; employeeNo: string; reason: string }>;
}

export async function backfillPensionSchemeHistory(args: BackfillArgs): Promise<BackfillReport> {
  const tenantIds = args.tenants.length > 0 ? args.tenants : await scopedPlatformRead((tx) => employeeRepo.listEmployeeTenantIds(tx));
  const report: BackfillReport = { dryRun: args.dryRun, tenants: tenantIds.length, planned: [], written: 0, skipped: [] };
  for (const tenantId of tenantIds) {
    const { employees, withHistory } = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      const emps = await tx.select({ id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo, pensionScheme: hrmsEmployees.pensionScheme, dateOfJoining: hrmsEmployees.dateOfJoining })
        .from(hrmsEmployees).where(eq(hrmsEmployees.tenantId, tenantId));
      const hist = await tx.selectDistinct({ employeeId: hrmsPensionSchemeChanges.employeeId }).from(hrmsPensionSchemeChanges)
        .where(eq(hrmsPensionSchemeChanges.tenantId, tenantId));
      return { employees: emps, withHistory: new Set(hist.map((h) => h.employeeId)) };
    }));
    const plan = planBackfill(employees, withHistory, args.corrections, args.reason);
    report.planned.push(...plan.rows.map((r) => ({ ...r, tenantId })));
    report.skipped.push(...plan.skipped.map((s) => ({ ...s, tenantId })));
    if (args.dryRun) continue;
    for (const r of plan.rows) {
      const wrote = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        const [locked] = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.id, r.employeeId), eq(hrmsEmployees.tenantId, tenantId))).for("update").limit(1);
        if (!locked) return false;
        const [existing] = await tx.select({ id: hrmsPensionSchemeChanges.id }).from(hrmsPensionSchemeChanges)
          .where(and(eq(hrmsPensionSchemeChanges.tenantId, tenantId), eq(hrmsPensionSchemeChanges.employeeId, r.employeeId))).limit(1);
        if (existing) return false; // raced: history appeared since the plan
        const now = new Date();
        const [row] = await tx.insert(hrmsPensionSchemeChanges).values({
          tenantId, employeeId: r.employeeId, fromScheme: r.fromScheme, toScheme: r.toScheme, effectiveFrom: r.effectiveFrom,
          reason: r.reason, status: "approved", kind: r.kind, requestedBy: SYSTEM_ACTOR, decidedBy: args.actor!, decidedAt: now,
          decisionNote: "history backfill", appliedAt: now, createdBy: args.actor!, updatedBy: args.actor!,
        }).returning({ id: hrmsPensionSchemeChanges.id });
        await enqueue(tx, {
          topic: "audit.event.record", eventType: "audit.event.record", tenantId, actorId: args.actor!, correlationId: randomUUID(),
          payload: {
            service: "hrms", action: "pension_scheme_history_backfill", resourceType: "employee", resourceId: r.employeeId, outcome: "success",
            oldValue: { pensionScheme: r.fromScheme }, newValue: { pensionScheme: r.toScheme, effectiveFrom: r.effectiveFrom, kind: r.kind },
            reason: r.reason, detail: { changeId: row!.id },
          },
        });
        return true;
      }));
      if (wrote) report.written += 1;
      else report.skipped.push({ tenantId, employeeNo: r.employeeNo, reason: "history appeared before the write" });
    }
  }
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    console.log(JSON.stringify(await backfillPensionSchemeHistory(args)));
  } finally {
    await sqlClient.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

/**
 * UAT T-PERIOD D-03 readiness: which expenditure heads would hit NO_BUDGET_PROVISION after bundle 19 deploys.
 * GFR (ERP-head decision 2026-11-05): a debit to an expenditure head with no budget.finance_budgets row for the FY is
 * refused. Before deploy, every expenditure head a tenant actually uses needs a provision for the CURRENT FY (IST).
 *
 * For each tenant it lists the expenditure heads (shared/head-nature.ts + budget/provision.ts rules) that have NO
 * provision for the current FY and are used by:
 *  - postings: debits in gl.finance_journal_lines in the last 90 days (non-exempt journal types);
 *  - payroll accrual mappings: the salary heads the payroll.run.approved accrual debits (5001 salary, 5002 employer);
 *  - open bills: payments.finance_bills not yet paid (draft / on_hold / pending / passed) on the head;
 *  - journals pending approval: the debit lines of gl.finance_journals still pending_approval (their approval is refused
 *    without a provision);
 *  - sanctions pending approval: budget.finance_sanctions draft / pending_approval on the head (their amount);
 * and prints the allocation that would be needed: suggested = max(90-day spend annualised (x 365/90), open bills +
 * pending journals + pending sanctions),
 * rounded up to the next Rs 1,000, at least Rs 1,000 for a mapping-only head. The suggestion is a starting point for the
 * budget section, not a sanctioned figure.
 *
 * DRY RUN BY DEFAULT: reads only (inside READ ONLY transactions). --apply inserts the suggested BE = RE rows into
 * budget.finance_budgets (ON CONFLICT DO NOTHING; never changes an existing budget) and is allowed ONLY with explicit
 * --tenant arguments. Not for live use without the owner OK.
 *
 * Usage (from services/finance-service; a role that can read every tenant, or pass --tenant):
 *   DATABASE_URL=... pnpm exec tsx scripts/uat-budget-readiness.ts [--tenant <uuid> ...] [--json]
 *   DATABASE_URL=... pnpm exec tsx scripts/uat-budget-readiness.ts --apply --tenant <uuid> [--tenant <uuid> ...]
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { needsBudgetProvision, PROVISION_EXEMPT_TYPES } from "../src/modules/budget/provision.js";
import { currentFyIST, todayIST } from "../src/shared/ist-date.js";
import { SEED_ACTOR } from "../src/modules/gl/standard-heads.js";

type Sql = ReturnType<typeof postgres>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The heads the payroll accrual debits (finance integrations/consumer.ts payroll.run.approved). */
export const PAYROLL_ACCRUAL_HEADS = ["5001", "5002"];
const RS_1000 = 100_000n; // paise

export type MissingHead = {
  headId: string; code: string; name: string; classification: string | null;
  sources: Array<"postings_90d" | "payroll_accrual" | "open_bills" | "journals_pending" | "sanctions_pending">;
  spend90dMinor: bigint; openBillsMinor: bigint; pendingJournalsMinor: bigint; pendingSanctionsMinor: bigint; suggestedMinor: bigint;
};
export type TenantReadiness = { tenantId: string; fy: string; missing: MissingHead[]; payrollHeadsAbsent: string[]; inserted: string[] };

/** Pure: the suggested allocation for a head (paise). */
export function suggestedAllocation(spend90dMinor: bigint, openWorkMinor: bigint): bigint {
  const annualised = (spend90dMinor * 365n + 89n) / 90n;
  const need = annualised > openWorkMinor ? annualised : openWorkMinor;
  const rounded = ((need + RS_1000 - 1n) / RS_1000) * RS_1000;
  return rounded > RS_1000 ? rounded : RS_1000;
}

const daysBefore = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

export async function budgetReadiness(
  sql: Sql, opts: { apply: boolean; tenants?: string[]; now?: Date },
): Promise<TenantReadiness[]> {
  if (opts.apply && !(opts.tenants && opts.tenants.length > 0)) throw new Error("--apply needs explicit --tenant arguments");
  const fy = currentFyIST(opts.now);
  const since = daysBefore(todayIST(opts.now), 90);
  const tenants = opts.tenants && opts.tenants.length > 0
    ? opts.tenants
    : (await sql<{ tenant_id: string }[]>`SELECT DISTINCT tenant_id::text AS tenant_id FROM budget.finance_heads ORDER BY 1`).map((r) => r.tenant_id);
  const out: TenantReadiness[] = [];
  for (const tenantId of tenants) {
    if (!UUID_RE.test(tenantId)) throw new Error(`not a tenant uuid: ${tenantId}`);
    const r = await sql.begin(opts.apply ? "read write" : "read only", async (tx) => {
      // Transaction-scoped tenant GUC (RLS), never a session SET (pgbouncer transaction pooling).
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const heads = await tx<{ id: string; code: string; name: string; classification: string | null }[]>`
        SELECT id::text AS id, code, name, classification FROM budget.finance_heads WHERE tenant_id = ${tenantId}::uuid`;
      const provided = new Set((await tx<{ head_id: string }[]>`
        SELECT head_id::text AS head_id FROM budget.finance_budgets WHERE tenant_id = ${tenantId}::uuid AND fy = ${fy}`).map((b) => b.head_id));
      const exempt = [...PROVISION_EXEMPT_TYPES];
      const spend = new Map((await tx<{ head_id: string; dr: string }[]>`
        SELECT head_id::text AS head_id, COALESCE(SUM(debit_minor), 0)::text AS dr FROM gl.finance_journal_lines
         WHERE tenant_id = ${tenantId}::uuid AND posting_date >= ${since}::date AND debit_minor > 0
           AND (journal_type IS NULL OR NOT (journal_type = ANY(${exempt})))
         GROUP BY head_id`).map((x) => [x.head_id, BigInt(x.dr)]));
      const bills = new Map((await tx<{ head_id: string; net: string }[]>`
        SELECT head_id::text AS head_id, COALESCE(SUM(net_minor), 0)::text AS net FROM payments.finance_bills
         WHERE tenant_id = ${tenantId}::uuid AND status IN ('draft', 'on_hold', 'pending', 'passed')
         GROUP BY head_id`).map((x) => [x.head_id, BigInt(x.net)]));
      // the debit lines of journals still waiting for a checker (accountCode is a head id or a code)
      const pendingLines = await tx<{ ref: string; dr: string }[]>`
        SELECT l->>'accountCode' AS ref, COALESCE(SUM((l->>'debitMinor')::numeric), 0)::text AS dr
          FROM gl.finance_journals j, jsonb_array_elements(j.lines) l
         WHERE j.tenant_id = ${tenantId}::uuid AND j.status = 'pending_approval' AND (l->>'debitMinor')::numeric > 0
         GROUP BY 1`;
      const sanctions = new Map((await tx<{ head_id: string; amt: string }[]>`
        SELECT head_id::text AS head_id, COALESCE(SUM(amount_minor), 0)::text AS amt FROM budget.finance_sanctions
         WHERE tenant_id = ${tenantId}::uuid AND status IN ('draft', 'pending_approval')
         GROUP BY head_id`).map((x) => [x.head_id, BigInt(x.amt)]));
      const byCode = new Map(heads.map((h) => [h.code, h]));
      const journals = new Map<string, bigint>();
      for (const l of pendingLines) {
        const head = UUID_RE.test(l.ref) ? heads.find((h) => h.id === l.ref) : byCode.get(l.ref);
        if (head) journals.set(head.id, (journals.get(head.id) ?? 0n) + BigInt(l.dr.split(".")[0]!));
      }
      const missing: MissingHead[] = [];
      for (const h of heads) {
        if (provided.has(h.id) || !needsBudgetProvision(h, { type: "journal" })) continue;
        const sources: MissingHead["sources"] = [];
        const spend90dMinor = spend.get(h.id) ?? 0n; const openBillsMinor = bills.get(h.id) ?? 0n;
        const pendingJournalsMinor = journals.get(h.id) ?? 0n; const pendingSanctionsMinor = sanctions.get(h.id) ?? 0n;
        if (spend90dMinor > 0n) sources.push("postings_90d");
        if (PAYROLL_ACCRUAL_HEADS.includes(h.code)) sources.push("payroll_accrual");
        if (openBillsMinor > 0n) sources.push("open_bills");
        if (pendingJournalsMinor > 0n) sources.push("journals_pending");
        if (pendingSanctionsMinor > 0n) sources.push("sanctions_pending");
        if (sources.length === 0) continue;
        missing.push({
          headId: h.id, code: h.code, name: h.name, classification: h.classification, sources,
          spend90dMinor, openBillsMinor, pendingJournalsMinor, pendingSanctionsMinor,
          suggestedMinor: suggestedAllocation(spend90dMinor, openBillsMinor + pendingJournalsMinor + pendingSanctionsMinor),
        });
      }
      missing.sort((a, b) => a.code.localeCompare(b.code));
      const inserted: string[] = [];
      if (opts.apply) {
        for (const m of missing) {
          const rows = await tx<{ id: string }[]>`
            INSERT INTO budget.finance_budgets (id, tenant_id, head_id, fy, be_minor, re_minor, created_by, updated_by)
            SELECT ${randomUUID()}::uuid, ${tenantId}::uuid, ${m.headId}::uuid, ${fy}, ${m.suggestedMinor.toString()}::bigint, ${m.suggestedMinor.toString()}::bigint, ${SEED_ACTOR}::uuid, ${SEED_ACTOR}::uuid
             WHERE NOT EXISTS (SELECT 1 FROM budget.finance_budgets WHERE tenant_id = ${tenantId}::uuid AND head_id = ${m.headId}::uuid AND fy = ${fy})
            RETURNING id::text AS id`;
          if (rows[0]) inserted.push(m.code);
        }
      }
      return { tenantId, fy, missing, payrollHeadsAbsent: PAYROLL_ACCRUAL_HEADS.filter((c) => !byCode.has(c)), inserted };
    });
    out.push(r as TenantReadiness);
  }
  return out;
}

const rupees = (p: bigint) => `Rs ${(p / 100n).toLocaleString("en-IN")}.${String(p % 100n).padStart(2, "0")}`;

export function parseArgs(argv: string[]): { apply: boolean; tenants: string[]; json: boolean } {
  const tenants: string[] = []; let apply = false; let dryRun = false; let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--json") json = true;
    else if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else throw new Error(`unknown argument: ${a}`);
  }
  if (apply && dryRun) throw new Error("--apply and --dry-run are mutually exclusive");
  return { apply, tenants, json };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const args = parseArgs(process.argv.slice(2));
  const sql = postgres(url, { max: 1 });
  try {
    const res = await budgetReadiness(sql, args);
    if (args.json) { console.log(JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)); return; }
    const tag = args.apply ? "" : "[dry-run] ";
    for (const t of res) {
      console.log(`${tag}tenant ${t.tenantId} FY ${t.fy}: ${t.missing.length} expenditure head(s) used without a budget provision`);
      for (const m of t.missing) {
        console.log(`  ${m.code} ${m.name} [${m.sources.join(", ")}] 90-day spend ${rupees(m.spend90dMinor)}, open bills ${rupees(m.openBillsMinor)}, journals pending ${rupees(m.pendingJournalsMinor)}, sanctions pending ${rupees(m.pendingSanctionsMinor)} -> allocation needed ~ ${rupees(m.suggestedMinor)}`);
      }
      if (t.payrollHeadsAbsent.length > 0) console.log(`  note: payroll accrual head(s) ${t.payrollHeadsAbsent.join(", ")} not in the chart (run backfill-standard-gl-heads)`);
      if (args.apply) console.log(`  inserted BE = RE for: ${t.inserted.join(", ") || "-"}`);
    }
    const total = res.reduce((s, t) => s + t.missing.reduce((a, m) => a + m.suggestedMinor, 0n), 0n);
    console.log(`${tag}tenants: ${res.length}, heads without provision: ${res.reduce((s, t) => s + t.missing.length, 0)}, suggested total ${rupees(total)}`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}

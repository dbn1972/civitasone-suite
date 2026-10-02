/**
 * PAY-PROFILES pre-deploy HRA-floor impact report (read-only CLI).
 *
 * Lists every payroll-eligible government-scale / deputation employee whose
 * HRA for --month would rise because of the 7th CPC minimum floor, with the
 * monthly increase, as CSV on stdout. It needs NOTHING from PAY-PROFILES'
 * own migrations (floors are given on the command line, defaulting to the
 * decided X 5,400 / Y 3,600 / Z 1,800), so it can be run against production
 * BEFORE the PAY-PROFILES deploy. Once deployed, the same report is served by
 * GET /v1/payroll/reports/hra-floor-impact?month=YYYY-MM.
 *
 * Run in the payroll-service package directory with the payroll worker's env
 * (DATABASE_URL as payroll_svc, HRMS_URL, INTERNAL_SERVICE_SECRET):
 *
 *   pnpm report:hra-floor-impact --tenant <uuid> [--tenant <uuid> ...] --month 2026-11 \
 *     [--floor-x 540000] [--floor-y 360000] [--floor-z 180000]
 *
 * Amounts are paise. Writes nothing.
 */
import { z } from "zod";
import { runWithTenant } from "@civitasone/db";
import { sqlClient, scopedRead, type db } from "../shared/db.js";
import { fetchPayrollInput } from "../shared/hrms-client.js";
import { resolveDaRateBps, resolveLatestRevisionsTx } from "../modules/payroll/consumer.js";
import { NO_ALLOWANCE_RULES } from "../modules/pay-profiles/allowance-rules.js";
import { hraFloorImpact } from "../modules/pay-profiles/reports.js";

const minor = z.string().regex(/^\d{1,9}$/);
const argsSchema = z.object({
  tenants: z.array(z.string().uuid()).min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  floorX: minor, floorY: minor, floorZ: minor,
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const tenants: string[] = [];
  let month = "";
  let floorX = "540000";
  let floorY = "360000";
  let floorZ = "180000";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--month") month = argv[++i] ?? "";
    else if (a === "--floor-x") floorX = argv[++i] ?? "";
    else if (a === "--floor-y") floorY = argv[++i] ?? "";
    else if (a === "--floor-z") floorZ = argv[++i] ?? "";
    else if (a !== "--") throw new Error(`unknown argument: ${a}`);
  }
  return argsSchema.parse({ tenants, month, floorX, floorY, floorZ });
}

const csv = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const floors = { X: BigInt(args.floorX), Y: BigInt(args.floorY), Z: BigInt(args.floorZ) };
  process.stdout.write("tenant_id,employee_no,full_name,pay_profile,city_class,basic_minor,da_rate_bps,slab_pct,slab_hra_minor,floor_minor,hra_minor,monthly_increase_minor\n");
  for (const tenantId of args.tenants) {
    const input = await fetchPayrollInput(tenantId, args.month);
    const { daRateBps, revisions } = await runWithTenant(tenantId, () => scopedRead(async (tx) => ({
      daRateBps: await resolveDaRateBps(tx as unknown as typeof db, tenantId, args.month),
      revisions: await resolveLatestRevisionsTx(tx as unknown as typeof db, tenantId, input.employees.map((e) => e.id), args.month),
    })));
    const revised = new Map([...revisions].map(([id, r]) => [id, r.newBasicMinor]));
    const r = hraFloorImpact(input.employees, args.month, daRateBps, NO_ALLOWANCE_RULES, revised, floors);
    for (const row of r.rows) {
      process.stdout.write([tenantId, row.employeeNo, row.fullName, row.payProfile, row.cityClass, row.basicMinor, row.daRateBps,
        row.slabPct, row.slabHraMinor, row.floorMinor, row.hraMinor, row.monthlyIncreaseMinor].map(csv).join(",") + "\n");
    }
    process.stderr.write(`${tenantId}: ${r.rows.length} of ${r.employeesConsidered} employees affected; total monthly increase ${r.totalMonthlyIncreaseMinor} paise\n`);
  }
}

main()
  .then(() => sqlClient.end())
  .catch(async (err: unknown) => {
    process.stderr.write(`hra-floor-impact failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });

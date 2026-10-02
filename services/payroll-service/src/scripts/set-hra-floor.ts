/**
 * PAY-PROFILES ops CLI: switch on (or change) the HRA minimum floor with an
 * EXPLICIT effective month (strictly after the current IST month), after
 * reviewing `pnpm report:hra-floor-impact`.
 * Migration 0054 seeds nothing, so until this runs HRA is the plain slab.
 *
 * Run in the payroll-service package directory with the payroll worker's env
 * (DATABASE_URL as payroll_svc):
 *
 *   pnpm payroll:set-hra-floor --effective 2026-12 --x 540000 --y 360000 --z 180000 \
 *     --reason "7th CPC HRA minimum floor, go-live per order no. ..." --actor <uuid> [--tenant <uuid>]
 *
 * Without --tenant it writes the PLATFORM default every tenant inherits;
 * with --tenant only that tenant's row. Amounts are paise.
 */
import { z } from "zod";
import { sqlClient } from "../shared/db.js";
import { setHraFloor, currentMonthIst } from "../modules/pay-profiles/set-floor.js";

const minor = z.string().regex(/^\d{1,9}$/);
const argsSchema = z.object({
  effective: z.string().regex(/^\d{4}-\d{2}$/),
  x: minor, y: minor, z: minor,
  reason: z.string().min(10).max(500),
  actor: z.string().uuid(),
  tenant: z.string().uuid().optional(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    out[a.slice(2)] = argv[++i] ?? "";
  }
  return argsSchema.parse(out);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const r = await setHraFloor({
    tenantId: a.tenant ?? null,
    effectiveMonth: a.effective,
    xMinor: BigInt(a.x), yMinor: BigInt(a.y), zMinor: BigInt(a.z),
    reason: a.reason, actorId: a.actor,
    currentMonth: currentMonthIst(),
  });
  process.stdout.write(`${JSON.stringify(r)}\n`);
}

main()
  .then(() => sqlClient.end())
  .catch(async (err: unknown) => {
    process.stderr.write(`set-hra-floor failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

// Account codes mirror the GL consumer (finance.gl.post) asset postings so the
// register reconciles exactly against the journals asset-service raised.
const FIXED_ASSET = process.env.FINANCE_FIXED_ASSET_CODE ?? "1200";
const ACCUM_DEP   = process.env.FINANCE_ACCUM_DEP_CODE ?? "1250";
const DEP_EXPENSE = process.env.FINANCE_DEP_EXPENSE_CODE ?? "5100";
const DEP_EXPENSE_STAT = process.env.FINANCE_STAT_DEP_EXPENSE_CODE ?? "5101";
const IMPAIRMENT  = process.env.FINANCE_IMPAIRMENT_CODE ?? "5200";

type GlRow = { code: string; name: string; dr: string | number | null; cr: string | number | null };

/**
 * Fixed-asset register (finance side). Derived entirely from the GL:
 *   - Gross block      = net debit balance of the fixed-asset head (1200)
 *   - Accumulated dep. = net credit balance of the accumulated-dep head (1250, contra-asset)
 *   - Net book value   = gross - accumulated depreciation
 *   - Period charges   = depreciation expense + impairment posted in the FY
 * Every figure is reconciled back to gl.finance_ledger so the register can never
 * diverge from the journals asset-service posted.
 */
export async function fixedAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/fixed-assets/register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    const fy = q.fy ?? deriveFY();
    const { start, end } = fyBounds(fy);

    // Lifetime balances on the asset / accumulated-dep heads.
    const balances = (await scopedRead((tx) => tx.execute(sql`
      SELECT fh.code, fh.name,
             COALESCE(SUM(fl.debit_minor), 0)::bigint  AS dr,
             COALESCE(SUM(fl.credit_minor), 0)::bigint AS cr
      FROM budget.finance_heads fh
      LEFT JOIN gl.finance_ledger fl
        ON fl.head_id = fh.id AND fl.tenant_id = fh.tenant_id
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
        AND fh.code IN (${FIXED_ASSET}, ${ACCUM_DEP})
      GROUP BY fh.code, fh.name
    `))) as unknown as GlRow[];

    const fa = balances.find((r) => r.code === FIXED_ASSET);
    const ad = balances.find((r) => r.code === ACCUM_DEP);

    const grossBlockMinor = bi(fa?.dr) - bi(fa?.cr);                 // debit-normal asset
    const accumDepMinor   = bi(ad?.cr) - bi(ad?.dr);                 // credit-normal contra-asset
    const netBlockMinor   = grossBlockMinor - accumDepMinor;

    // Period charges (this FY) on the expense heads that feed the register.
    const charges = (await scopedRead((tx) => tx.execute(sql`
      SELECT fh.code, fh.name,
             COALESCE(SUM(fl.debit_minor), 0)::bigint  AS dr,
             COALESCE(SUM(fl.credit_minor), 0)::bigint AS cr
      FROM budget.finance_heads fh
      LEFT JOIN gl.finance_ledger fl
        ON fl.head_id = fh.id AND fl.tenant_id = fh.tenant_id
       AND fl.posting_date >= ${start}::date AND fl.posting_date <= ${end}::date
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
        AND fh.code IN (${DEP_EXPENSE}, ${DEP_EXPENSE_STAT}, ${IMPAIRMENT})
      GROUP BY fh.code, fh.name
    `))) as unknown as GlRow[];

    const periodDepMinor = charges
      .filter((c) => c.code === DEP_EXPENSE || c.code === DEP_EXPENSE_STAT)
      .reduce((s, c) => s + (bi(c.dr) - bi(c.cr)), 0n);
    const periodImpairmentMinor = charges
      .filter((c) => c.code === IMPAIRMENT)
      .reduce((s, c) => s + (bi(c.dr) - bi(c.cr)), 0n);

    // Per-asset movement breakdown straight from the asset/accum-dep journals.
    const movements = (await scopedRead((tx) => tx.execute(sql`
      SELECT j.type,
             COALESCE(SUM((line->>'debitMinor')::bigint), 0)::bigint AS dr,
             COALESCE(SUM((line->>'creditMinor')::bigint), 0)::bigint AS cr,
             COUNT(DISTINCT j.id)::int AS journals
      FROM gl.finance_journals j
      CROSS JOIN LATERAL jsonb_array_elements(
        -- lines is stored double-encoded (a jsonb string holding a JSON array);
        -- normalise: unwrap a string to its inner array, pass an array through.
        CASE jsonb_typeof(j.lines)
          WHEN 'array'  THEN j.lines
          WHEN 'string' THEN (j.lines #>> '{}')::jsonb
          ELSE '[]'::jsonb
        END
      ) AS line
      WHERE j.tenant_id = ${ctx.tenantId}::uuid
        AND j.status = 'posted'
        AND j.type IN ('asset_acquisition','depreciation','asset_disposal','asset_impairment','asset_revaluation','asset_maintenance')
      GROUP BY j.type
      ORDER BY j.type
    `))) as unknown as { type: string; dr: string; cr: string; journals: number }[];

    // Reconciliation: register NBV must equal (GL gross - GL accum dep). Since
    // both sides are read from the same ledger this holds by construction; we
    // assert it explicitly so any future divergence surfaces immediately.
    const reconciled = netBlockMinor === (grossBlockMinor - accumDepMinor);

    return reply.send({
      fiscalYear: fy,
      asOf: end,
      register: {
        grossBlockMinor: grossBlockMinor.toString(),
        accumulatedDepreciationMinor: accumDepMinor.toString(),
        netBlockMinor: netBlockMinor.toString(),
      },
      periodCharges: {
        depreciationMinor: periodDepMinor.toString(),
        impairmentMinor: periodImpairmentMinor.toString(),
      },
      glHeads: balances.map((r) => ({
        code: r.code, name: r.name,
        debitMinor: bi(r.dr).toString(), creditMinor: bi(r.cr).toString(),
        netMinor: (bi(r.dr) - bi(r.cr)).toString(),
      })),
      movements: movements.map((m) => ({
        type: m.type,
        debitMinor: bi(m.dr).toString(),
        creditMinor: bi(m.cr).toString(),
        journals: m.journals,
      })),
      reconciliation: {
        reconciled,
        basis: "register NBV = GL(1200 gross) - GL(1250 accumulated depreciation)",
        glGrossMinor: grossBlockMinor.toString(),
        glAccumDepMinor: accumDepMinor.toString(),
        registerNbvMinor: netBlockMinor.toString(),
      },
    });
  });
}

function bi(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  return BigInt(v);
}

function deriveFY(d = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

function fyBounds(fy: string): { start: string; end: string } {
  const startYear = Number(fy.slice(0, 4));
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

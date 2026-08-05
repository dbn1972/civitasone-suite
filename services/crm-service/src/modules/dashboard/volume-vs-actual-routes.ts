/**
 * Gap 7 — Volume-vs-Actual Dashboard Endpoint.
 * Compares committed volume (from contract/account plan terms) vs actual
 * deal value closed, grouped by account/period.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const ROLES = ["crm_user", "crm_admin", "super_admin", "sales_officer"];

const querySchema = z.object({
  period: z.string().optional(), // e.g. "2025-Q1" or "2025"
  accountId: z.string().uuid().optional(),
});

export async function volumeVsActualRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/dashboard/volume-vs-actual", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = querySchema.parse(req.query);

    const accountFilter = q.accountId ? sql`AND a.id = ${q.accountId}` : sql``;
    // Period filtering based on deal closed_at year-quarter
    const periodFilter = q.period ? sql`AND to_char(d.closed_at, 'YYYY-"Q"Q') = ${q.period}` : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT
        a.id AS "accountId",
        a.name AS "accountName",
        to_char(d.closed_at, 'YYYY-"Q"Q') AS "period",
        COALESCE(SUM(d.closed_value_minor), 0)::text AS "actualValueMinor",
        COALESCE(
          (SELECT SUM((objectives->>'targetMinor')::bigint)
           FROM crm.account_plans ap,
                LATERAL jsonb_array_elements(ap.objectives) AS objectives
           WHERE ap.account_id = a.id AND ap.tenant_id = ${ctx.tenantId}
             AND ap.status = 'active'),
          0
        )::text AS "committedValueMinor"
      FROM crm.accounts a
      LEFT JOIN crm.deals d
        ON d.tenant_id = a.tenant_id
        AND d.status = 'active'
        AND d.close_outcome = 'won'
        AND d.closed_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM crm.contacts c
          WHERE c.id = d.contact_id AND c.account_id = a.id AND c.tenant_id = a.tenant_id
        )
      WHERE a.tenant_id = ${ctx.tenantId}
        ${accountFilter}
        ${periodFilter}
      GROUP BY a.id, a.name, to_char(d.closed_at, 'YYYY-"Q"Q')
      HAVING COALESCE(SUM(d.closed_value_minor), 0) > 0
         OR EXISTS (
           SELECT 1 FROM crm.account_plans ap
           WHERE ap.account_id = a.id AND ap.tenant_id = ${ctx.tenantId} AND ap.status = 'active'
         )
      ORDER BY a.name, "period"
    `))) as unknown as Array<Record<string, unknown>>;

    const data = rows.map((r) => ({
      ...r,
      variance: String(BigInt(r.actualValueMinor as string) - BigInt(r.committedValueMinor as string)),
    }));

    return reply.send({ data, meta: { total: data.length } });
  });
}

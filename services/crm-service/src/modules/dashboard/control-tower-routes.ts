/**
 * P2-8 Executive control tower — minimal GIS / exception / drill-down slice.
 *
 * GET /v1/crm/dashboard/control-tower
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin", "sales_officer"];

export type ControlTowerRegion = {
  region: string;
  dealCount: number;
  pipelineMinor: string;
};

export type ControlTowerException = {
  id: string;
  kind: "overdue_follow_up" | "dormant_account" | "aged_lead";
  label: string;
  severity: "high" | "medium";
  href: string;
  count: number;
};

export async function controlTowerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/dashboard/control-tower", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const { regions, overdue, dormant, aged } = await scopedRead(async (tx) => {
      const regions = (await tx.execute(sql`
        SELECT min(btrim(COALESCE(c.region, c.city, 'unknown'))) AS region,
               count(d.id)::int AS "dealCount",
               COALESCE(sum(d.value_minor), 0)::text AS "pipelineMinor"
        FROM crm.deals d
        LEFT JOIN crm.contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
        WHERE d.tenant_id = ${ctx.tenantId}
          AND d.status = 'active'
        -- GAP-CRM-CONTROL-TOWER-02: region is free text, so group on a
        -- trimmed, case-folded key to stop "South" / " south " splitting into
        -- two rows; display the first spelling via min() of the trimmed value.
        GROUP BY lower(btrim(COALESCE(c.region, c.city, 'unknown')))
        ORDER BY sum(d.value_minor) DESC NULLS LAST
        LIMIT 50
      `)) as unknown as ControlTowerRegion[];

      const overdueRows = (await tx.execute(sql`
        SELECT count(*)::int AS count
        FROM crm.activities a
        WHERE a.tenant_id = ${ctx.tenantId}
          AND a.due_date IS NOT NULL
          AND a.due_date < CURRENT_DATE
          AND a.status = 'open'
      `)) as unknown as Array<{ count: number }>;

      const dormantRows = (await tx.execute(sql`
        SELECT count(*)::int AS count
        FROM (
          SELECT a.id
          FROM crm.accounts a
          LEFT JOIN crm.activities act
            ON act.account_id = a.id AND act.tenant_id = ${ctx.tenantId}
          WHERE a.tenant_id = ${ctx.tenantId}
            AND a.status = 'active'
          GROUP BY a.id, a.created_at
          HAVING COALESCE(max(act.created_at), a.created_at) < now() - interval '90 days'
        ) sub
      `)) as unknown as Array<{ count: number }>;

      const agedRows = (await tx.execute(sql`
        SELECT count(*)::int AS count
        FROM crm.contacts c
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.lead_status IS NOT NULL
          AND c.lead_status NOT IN ('converted', 'disqualified', 'lost')
          AND c.created_at < now() - interval '30 days'
      `)) as unknown as Array<{ count: number }>;

      return {
        regions,
        overdue: overdueRows[0]?.count ?? 0,
        dormant: dormantRows[0]?.count ?? 0,
        aged: agedRows[0]?.count ?? 0,
      };
    });

    const exceptions: ControlTowerException[] = [
      {
        id: "overdue_follow_up",
        kind: "overdue_follow_up",
        label: "Overdue follow-ups",
        severity: overdue > 0 ? "high" : "medium",
        // /crm/activities has a real Overdue segment (and its own Overdue stat
        // card) that shows exactly these records; /crm/dashboard has no
        // overdue-specific content at all, so it was a drill-down to nothing.
        href: "/crm/activities?segment=Overdue",
        count: overdue,
      },
      {
        id: "aged_lead",
        kind: "aged_lead",
        label: "Leads ageing past 30 days",
        severity: aged > 10 ? "high" : "medium",
        // GAP2-CRM-CONTROL-TOWER-07: there is no aged-lead view that filters the
        // contact register to lead age > 30d, so the previous href "/crm/dashboard"
        // was a drill-down to a page that shows none of these records. Rather than
        // send the operator somewhere that cannot show the drilled-into leads, the
        // affordance is dropped: an empty href makes ExceptionTable render a
        // disabled "Open" (isSafeInternalHref("") === false) instead of a dead
        // link. Re-point this at a real age-filtered leads view once one exists.
        href: "",
        count: aged,
      },
      {
        id: "dormant_account",
        kind: "dormant_account",
        label: "Dormant accounts (90d)",
        severity: "medium",
        href: "/crm/accounts",
        count: dormant,
      },
    ];

    return reply.send({
      data: {
        regions: regions.map((r) => ({
          region: String(r.region ?? "unknown"),
          dealCount: Number(r.dealCount ?? 0),
          pipelineMinor: String(r.pipelineMinor ?? "0"),
        })),
        exceptions,
        // GAP2-CRM-CONTROL-TOWER-07: both reports used to point at /crm/dashboard,
        // which has neither a region breakdown nor an aged-lead list. The region
        // report IS this control-tower screen's "Pipeline by region" table, so
        // regionReport points back here (a real, populated view). ageingReport is
        // emptied because no aged-lead view exists yet — an empty string signals
        // "no drill-down available" rather than a dead link to unrelated tiles.
        drillDown: {
          regionReport: "/crm/control-tower",
          ageingReport: "",
          accounts: "/crm/accounts",
        },
      },
    });
  });
}

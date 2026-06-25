import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { contacts } from "../contacts/schema.js";
import { deals } from "../deals/schema.js";
import { activities } from "../activities/schema.js";

/** Cache key for the per-tenant dashboard summary aggregate. */
export const DASHBOARD_RESOURCE = "dashboard";
export function dashboardKey(tenantId: string): string {
  return cache.makeKey(tenantId, DASHBOARD_RESOURCE, "summary");
}

/**
 * Invalidate the cached dashboard summary for a tenant. The summary aggregates
 * live contacts/deals/activities, so EVERY mutating consumer (contact/deal/
 * activity create/update/delete/merge/bulk-import) must call this after its DB
 * tx commits — otherwise totalContacts/openDeals/pipelineValue/activitiesToday
 * go stale until the TTL expires. (Closes the deleteContact stale-count gap.)
 */
export async function invalidateDashboard(tenantId: string): Promise<void> {
  await cache.invalidate(dashboardKey(tenantId));
}

export async function getDashboard(tenantId: string) {
  return cache.getOrLoad(
    dashboardKey(tenantId),
    async () => {
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);

      const [contactRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} <> 'deleted'`));

      const [openDeals] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .where(and(eq(deals.tenantId, tenantId), eq(deals.status, "active")));

      const [pipeline] = await db
        .select({ total: sql<string>`coalesce(sum(${deals.valueMinor}), 0)::bigint` })
        .from(deals)
        .where(and(eq(deals.tenantId, tenantId), eq(deals.status, "active")));

      const [todayActs] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(activities)
        .where(and(eq(activities.tenantId, tenantId), gte(activities.createdAt, todayUtc)));

      // Keep the pipeline sum exact as paise (bigint). Postgres returns the
      // ::bigint sum as a string; never coerce the full paise total through
      // float. Convert to rupees from the exact integer paise components.
      const pipelinePaise = BigInt(pipeline?.total ?? "0");
      const rupees = pipelinePaise / 100n;
      const paise = (pipelinePaise % 100n).toString().padStart(2, "0");
      return {
        totalContacts: contactRow?.count ?? 0,
        openDeals: openDeals?.count ?? 0,
        activitiesToday: todayActs?.count ?? 0,
        pipelineValue: Number(`${rupees}.${paise}`),
      };
    },
  );
}

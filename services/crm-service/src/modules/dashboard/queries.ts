import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { contacts } from "../contacts/schema.js";
import { deals } from "../deals/schema.js";
import { activities } from "../activities/schema.js";

export async function getDashboard(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "dashboard", "summary"),
    async () => {
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);

      const [contactRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .where(eq(contacts.tenantId, tenantId));

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

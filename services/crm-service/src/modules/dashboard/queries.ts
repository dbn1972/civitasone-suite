import { eq, and, or, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contacts } from "../contacts/schema.js";
import { deals } from "../deals/schema.js";

export async function getDashboard(tenantId: string) {
  const [contactRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.tenantId, tenantId));

  const [openDeals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.status, "active")));

  const [pipeline] = await db
    .select({ total: sql<number>`coalesce(sum(${deals.valueMinor}), 0)::bigint` })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.status, "active")));

  return {
    totalContacts: contactRow?.count ?? 0,
    openDeals: openDeals?.count ?? 0,
    activitiesToday: 0,
    pipelineValue: Number(pipeline?.total ?? 0) / 100,
  };
}

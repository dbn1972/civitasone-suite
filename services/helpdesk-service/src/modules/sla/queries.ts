import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tickets } from "../tickets/schema.js";
import { slaPolicies, csatResponses } from "./schema.js";
import { evaluateSlaStatus, resolvePolicy, DEFAULT_SLA_POLICIES, type SlaPolicy } from "./domain.js";

/** Minimal ticket projection used by command pre-checks on the SLA routes. */
export async function findTicket(
  tenantId: string,
  ticketId: string,
): Promise<{ id: string; status: string } | null> {
  const [row] = await db.transaction((tx) =>
    tx
      .select({ id: tickets.id, status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export async function findCsatForTicket(tenantId: string, ticketId: string) {
  const [row] = await db.transaction((tx) =>
    tx
      .select()
      .from(csatResponses)
      .where(and(eq(csatResponses.ticketId, ticketId), eq(csatResponses.tenantId, tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export async function loadPolicies(tenantId: string): Promise<SlaPolicy[]> {
  try {
    const policies = await db.transaction((tx) =>
      tx.select().from(slaPolicies).where(eq(slaPolicies.tenantId, tenantId)),
    );
    if (policies.length === 0) {
      return DEFAULT_SLA_POLICIES.map((p, i) => ({
        id: `default-${i}`,
        tenantId,
        ...p,
      }));
    }
    return policies.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
      priority: p.priority,
      category: p.category,
      responseMinutes: p.responseMinutes,
      resolutionMinutes: p.resolutionMinutes,
    }));
  } catch {
    return DEFAULT_SLA_POLICIES.map((p, i) => ({
      id: `default-${i}`,
      tenantId,
      ...p,
    }));
  }
}

export async function dashboard(tenantId: string) {
  const policyList = await loadPolicies(tenantId);
  const rows = await db.transaction((tx) =>
    tx.select().from(tickets).where(eq(tickets.tenantId, tenantId)),
  );
  let withinSla = 0;
  let breached = 0;
  let atRisk = 0;
  const now = new Date();

  for (const row of rows) {
    if (row.status === "closed" || row.status === "resolved") {
      withinSla++;
      continue;
    }
    const policy = resolvePolicy(policyList, row.priority, null);
    if (!policy) {
      withinSla++;
      continue;
    }
    const { status } = evaluateSlaStatus(now, new Date(row.createdAt as unknown as string), policy);
    if (status === "breached") breached++;
    else if (status === "at_risk") atRisk++;
    else withinSla++;
  }

  return { totalTickets: rows.length, withinSla, breached, atRisk };
}

export async function listPolicies(tenantId: string) {
  try {
    const rows = await db.transaction((tx) =>
      tx.select().from(slaPolicies).where(eq(slaPolicies.tenantId, tenantId)),
    );
    if (rows.length === 0) {
      return { data: DEFAULT_SLA_POLICIES, meta: { source: "defaults" as const } };
    }
    return { data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } };
  } catch {
    return { data: DEFAULT_SLA_POLICIES, meta: { source: "defaults" as const } };
  }
}

export async function csatStats(tenantId: string) {
  const rows = await db.transaction((tx) =>
    tx.select().from(csatResponses).where(eq(csatResponses.tenantId, tenantId)),
  );
  const total = rows.length;
  if (total === 0) {
    return { total: 0, average: null, distribution: {} };
  }
  const sum = rows.reduce((acc, r) => acc + r.rating, 0);
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rows) {
    distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
  }
  return {
    total,
    average: Math.round((sum / total) * 100) / 100,
    distribution,
  };
}

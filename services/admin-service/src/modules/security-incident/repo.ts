import { and, eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { secIncidents, secIncidentTimeline, secBreachNotifications } from "./schema.js";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listIncidents(tenantId: string) {
  return scopedRead((tx) =>
    tx.select().from(secIncidents).where(eq(secIncidents.tenantId, tenantId)).orderBy(desc(secIncidents.detectedAt)).limit(200),
  );
}

export function findIncident(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(secIncidents)
      .where(and(eq(secIncidents.tenantId, tenantId), eq(secIncidents.id, id))).limit(1);
    return rows[0];
  });
}

export function timelineFor(tenantId: string, incidentId: string) {
  return scopedRead((tx) =>
    tx.select().from(secIncidentTimeline)
      .where(and(eq(secIncidentTimeline.tenantId, tenantId), eq(secIncidentTimeline.incidentId, incidentId)))
      .orderBy(secIncidentTimeline.at),
  );
}

export function breachNotificationsFor(tenantId: string, incidentId: string) {
  return scopedRead((tx) =>
    tx.select().from(secBreachNotifications)
      .where(and(eq(secBreachNotifications.tenantId, tenantId), eq(secBreachNotifications.incidentId, incidentId)))
      .orderBy(desc(secBreachNotifications.createdAt)),
  );
}

export function listBreachNotifications(tenantId: string) {
  return scopedRead((tx) =>
    tx.select().from(secBreachNotifications)
      .where(eq(secBreachNotifications.tenantId, tenantId))
      .orderBy(secBreachNotifications.deadlineAt),
  );
}

// tx-scoped helpers used inside route transactions
export async function findIncidentTx(tx: Tx, tenantId: string, id: string) {
  const rows = await tx.select().from(secIncidents)
    .where(and(eq(secIncidents.tenantId, tenantId), eq(secIncidents.id, id))).limit(1);
  return rows[0];
}

export async function findBreachTx(tx: Tx, tenantId: string, incidentId: string, id: string) {
  const rows = await tx.select().from(secBreachNotifications)
    .where(and(eq(secBreachNotifications.tenantId, tenantId), eq(secBreachNotifications.id, id))).limit(1);
  return rows[0]?.incidentId === incidentId ? rows[0] : undefined;
}

export async function appendTimeline(tx: Tx, row: {
  tenantId: string; incidentId: string; actorId: string;
  fromStatus: string | null; toStatus: string | null; note?: string | null;
}): Promise<void> {
  await tx.insert(secIncidentTimeline).values(row);
}

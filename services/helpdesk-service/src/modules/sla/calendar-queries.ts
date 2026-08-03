import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { businessCalendars } from "./calendar-schema.js";
import { ticketEscalations } from "./schema.js";
import { tickets } from "../tickets/schema.js";
import { slaPauses } from "./pause-schema.js";
import { cesResponses } from "./ces-schema.js";

export async function listCalendars(tenantId: string, limit: number, offset: number) {
  const rows = await db.transaction((tx) =>
    tx.select().from(businessCalendars)
      .where(eq(businessCalendars.tenantId, tenantId))
      .limit(limit).offset(offset),
  );
  const [countRow] = await db.transaction((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(businessCalendars)
      .where(eq(businessCalendars.tenantId, tenantId)),
  );
  return { rows, total: countRow?.count ?? 0 };
}

export async function findCalendar(tenantId: string, id: string) {
  const [row] = await db.transaction((tx) =>
    tx.select().from(businessCalendars)
      .where(and(eq(businessCalendars.id, id), eq(businessCalendars.tenantId, tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export async function ticketExists(tenantId: string, ticketId: string): Promise<boolean> {
  const [row] = await db.transaction((tx) =>
    tx.select({ id: tickets.id }).from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .limit(1),
  );
  return !!row;
}

export async function findActivePause(tenantId: string, ticketId: string) {
  const [row] = await db.transaction((tx) =>
    tx.select().from(slaPauses).where(and(
      eq(slaPauses.ticketId, ticketId),
      eq(slaPauses.tenantId, tenantId),
      isNull(slaPauses.resumedAt),
    )).limit(1),
  );
  return row ?? null;
}

export async function findCesForTicket(tenantId: string, ticketId: string) {
  const [row] = await db.transaction((tx) =>
    tx.select().from(cesResponses)
      .where(and(eq(cesResponses.ticketId, ticketId), eq(cesResponses.tenantId, tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export async function listEscalations(tenantId: string, limit: number, offset: number) {
  const rows = await db.transaction((tx) =>
    tx.select({
      id: ticketEscalations.id,
      ticketId: ticketEscalations.ticketId,
      ticketSubject: tickets.subject,
      escalatedAt: ticketEscalations.escalatedAt,
      level: ticketEscalations.level,
      reason: ticketEscalations.reason,
      escalatedBy: ticketEscalations.escalatedBy,
    })
      .from(ticketEscalations)
      .innerJoin(tickets, eq(ticketEscalations.ticketId, tickets.id))
      .where(eq(ticketEscalations.tenantId, tenantId))
      .orderBy(desc(ticketEscalations.escalatedAt))
      .limit(limit).offset(offset),
  );
  const [countRow] = await db.transaction((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(ticketEscalations)
      .where(eq(ticketEscalations.tenantId, tenantId)),
  );
  return { rows, total: countRow?.count ?? 0 };
}

import { eq, and, lt, sql, or, isNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenTickets, citizenTicketNotes, ticketEscalations,
  type TicketRow, type TicketInsert, type TicketNoteInsert, type EscalationInsert,
} from "./schema.js";
import { computeSlaDueAt } from "./sla.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findTicketById(id: string): Promise<TicketRow | null> {
  const rows = await db.select().from(citizenTickets).where(eq(citizenTickets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findTicketByIdTx(tx: Writer, id: string): Promise<TicketRow | null> {
  const rows = await (tx as typeof db).select().from(citizenTickets).where(eq(citizenTickets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listNotes(ticketId: string) {
  return db.select().from(citizenTicketNotes).where(eq(citizenTicketNotes.ticketId, ticketId));
}

export async function listTicketsByTenant(
  tenantId: string,
  status?: string,
  limit = 100,
  slaStatus?: string,
): Promise<TicketRow[]> {
  const now = new Date();
  const conditions = [eq(citizenTickets.tenantId, tenantId)];
  if (status) conditions.push(eq(citizenTickets.status, status));
  if (slaStatus === "breached") {
    conditions.push(or(eq(citizenTickets.status, "open"), eq(citizenTickets.status, "in_progress"))!);
    conditions.push(or(lt(citizenTickets.slaDueAt, now), and(isNull(citizenTickets.slaDueAt), lt(citizenTickets.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))))!);
  } else if (slaStatus === "due_soon") {
    const soon = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    conditions.push(or(eq(citizenTickets.status, "open"), eq(citizenTickets.status, "in_progress"))!);
    conditions.push(sql`${citizenTickets.slaDueAt} IS NOT NULL AND ${citizenTickets.slaDueAt} > ${now} AND ${citizenTickets.slaDueAt} <= ${soon}`);
  } else if (slaStatus === "within_sla") {
    conditions.push(or(eq(citizenTickets.status, "closed"), eq(citizenTickets.status, "resolved"), sql`${citizenTickets.slaDueAt} IS NULL OR ${citizenTickets.slaDueAt} > ${new Date(now.getTime() + 4 * 60 * 60 * 1000)}`)!);
  }
  return db.select().from(citizenTickets).where(and(...conditions)).limit(limit);
}

export async function countBreachedTickets(tenantId: string): Promise<number> {
  const now = new Date();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(citizenTickets)
    .where(
      and(
        eq(citizenTickets.tenantId, tenantId),
        or(eq(citizenTickets.status, "open"), eq(citizenTickets.status, "in_progress")),
        or(lt(citizenTickets.slaDueAt, now), and(isNull(citizenTickets.slaDueAt), lt(citizenTickets.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)))),
      ),
    );
  return row?.count ?? 0;
}

export async function countTicketsByStatus(tenantId: string): Promise<Array<{ status: string; count: number }>> {
  const rows = await db.select({
    status: citizenTickets.status,
    count: sql<number>`count(*)::int`,
  }).from(citizenTickets).where(eq(citizenTickets.tenantId, tenantId)).groupBy(citizenTickets.status);
  return rows;
}

export async function countEscalationsByTenant(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketEscalations)
    .where(eq(ticketEscalations.tenantId, tenantId));
  return row?.count ?? 0;
}

export async function insertTicket(tx: Writer, row: TicketInsert): Promise<void> {
  const slaDueAt = row.slaDueAt ?? computeSlaDueAt(row.priority ?? "medium", row.createdAt ?? new Date());
  await tx.insert(citizenTickets).values({ ...row, slaDueAt });
}

export async function updateTicket(tx: Writer, id: string, patch: Partial<TicketInsert>): Promise<void> {
  await tx.update(citizenTickets).set({ ...patch, updatedAt: new Date() }).where(eq(citizenTickets.id, id));
}

export async function insertNote(tx: Writer, row: TicketNoteInsert): Promise<void> {
  await tx.insert(citizenTicketNotes).values(row);
}

export async function insertEscalation(tx: Writer, row: EscalationInsert): Promise<void> {
  await tx.insert(ticketEscalations).values(row);
}

export async function countEscalationsForTicket(tenantId: string, ticketId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketEscalations)
    .where(and(eq(ticketEscalations.tenantId, tenantId), eq(ticketEscalations.ticketId, ticketId)));
  return row?.count ?? 0;
}

import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { citizenTickets, citizenTicketNotes, type TicketRow, type TicketInsert, type TicketNoteInsert } from "./schema.js";

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

export async function listTicketsByTenant(tenantId: string, status?: string, limit = 100): Promise<TicketRow[]> {
  const conditions = [eq(citizenTickets.tenantId, tenantId)];
  if (status) conditions.push(eq(citizenTickets.status, status));
  return db.select().from(citizenTickets).where(and(...conditions)).limit(limit);
}

export async function countTicketsByStatus(tenantId: string): Promise<Array<{ status: string; count: number }>> {
  const rows = await db.select({
    status: citizenTickets.status,
    count: sql<number>`count(*)::int`,
  }).from(citizenTickets).where(eq(citizenTickets.tenantId, tenantId)).groupBy(citizenTickets.status);
  return rows;
}

export async function insertTicket(tx: Writer, row: TicketInsert): Promise<void> {
  await tx.insert(citizenTickets).values(row);
}

export async function updateTicket(tx: Writer, id: string, patch: Partial<TicketInsert>): Promise<void> {
  await tx.update(citizenTickets).set({ ...patch, updatedAt: new Date() }).where(eq(citizenTickets.id, id));
}

export async function insertNote(tx: Writer, row: TicketNoteInsert): Promise<void> {
  await tx.insert(citizenTicketNotes).values(row);
}

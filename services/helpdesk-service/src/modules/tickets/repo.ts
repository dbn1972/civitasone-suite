import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tickets, type TicketRow, type TicketInsert, type TicketView } from "./schema.js";

function mapStatus(status: string): TicketView["status"] {
  const s = status.toLowerCase();
  if (s === "closed") return "Closed";
  if (s === "resolved") return "Resolved";
  if (s === "in_progress" || s === "assigned") return "In Progress";
  return "Open";
}

function mapPriority(priority: string): TicketView["priority"] {
  const p = priority.toLowerCase();
  if (p === "low") return "Low";
  if (p === "high") return "High";
  if (p === "critical") return "Critical";
  return "Medium";
}

export function toView(r: TicketRow): TicketView {
  return {
    id: r.id,
    subject: r.subject,
    priority: mapPriority(r.priority),
    status: mapStatus(r.status),
  };
}

export async function findById(id: string, tenantId: string): Promise<TicketView | null> {
  const rows = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TicketView[]> {
  const rows = await db.select().from(tickets)
    .where(eq(tickets.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TicketInsert): Promise<void> {
  await tx.insert(tickets).values(row);
}

export { mapStatus, mapPriority };

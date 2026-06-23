import { eq, asc } from "drizzle-orm";
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

/** Compute SLA due date (3 business days for High/Critical, 5 for others) and breach status. */
function computeSla(r: TicketRow): { dueDate: string; slaStatus: "within_sla" | "at_risk" | "breached" } {
  const priority = r.priority?.toLowerCase() ?? "medium";
  const slaDays = (priority === "high" || priority === "critical") ? 3 : 5;
  const created = new Date(r.createdAt as unknown as string);
  const due = new Date(created.getTime() + slaDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
  const slaStatus: "within_sla" | "at_risk" | "breached" =
    hoursLeft < 0 ? "breached" : hoursLeft < 24 ? "at_risk" : "within_sla";
  return { dueDate: due.toISOString(), slaStatus };
}

export function toView(r: TicketRow): TicketView {
  const sla = computeSla(r);
  return {
    id: r.id,
    subject: r.subject,
    priority: mapPriority(r.priority),
    status: mapStatus(r.status),
    dueDate: sla.dueDate,
    slaStatus: sla.slaStatus,
    ...(r.assigneeId ? { assignee: r.assigneeId } : {}),
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
    /* C-05: Sort by SLA urgency — soonest dueDate first so most-at-risk tickets surface at top */
    .orderBy(asc(tickets.createdAt))
    .limit(limit)
    .offset(offset);
  // Post-sort: breached → at_risk → within_sla for the SLA queue view
  const views = rows.map(toView);
  const slaPriority: Record<string, number> = { breached: 0, at_risk: 1, within_sla: 2 };
  return views.sort((a, b) => {
    const ap = slaPriority[a.slaStatus ?? "within_sla"] ?? 2;
    const bp = slaPriority[b.slaStatus ?? "within_sla"] ?? 2;
    if (ap !== bp) return ap - bp;
    // Within same SLA status, sort by dueDate ascending
    return new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime();
  });
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TicketInsert): Promise<void> {
  await tx.insert(tickets).values(row);
}

export { mapStatus, mapPriority };

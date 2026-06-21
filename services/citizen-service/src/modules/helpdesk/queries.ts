import type { HelpdeskTicketStatus, HelpdeskTicketSummary } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { TicketRow } from "./schema.js";

function mapTicketStatus(status: string): HelpdeskTicketStatus {
  const s = status.toLowerCase();
  if (s === "closed") return "Closed";
  if (s === "resolved") return "Resolved";
  if (s === "in_progress" || s === "assigned") return "In Progress";
  return "Open";
}

function toSummary(row: TicketRow): HelpdeskTicketSummary {
  return {
    id: row.id,
    subject: row.subject,
    priority: "Medium",
    status: mapTicketStatus(row.status),
  };
}

export async function getTicket(tenantId: string, id: string): Promise<(TicketRow & { notes: Awaited<ReturnType<typeof repo.listNotes>> }) | null> {
  const ticket = await cache.getOrLoad<TicketRow | null>(
    cache.makeKey(tenantId, "ticket", id),
    () => repo.findTicketById(id),
  );
  if (!ticket || ticket.tenantId !== tenantId) return null;
  const notes = await repo.listNotes(id);
  return { ...ticket, notes };
}

export async function listTickets(
  tenantId: string,
  limit: number,
  slaStatus?: string,
): Promise<{ data: HelpdeskTicketSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  const cacheKey = `list:${limit}:${slaStatus ?? "all"}`;
  return cache.listOrLoad(tenantId, "ticket", cacheKey, async () => {
    const rows = await repo.listTicketsByTenant(tenantId, undefined, limit, slaStatus);
    return {
      data: rows.map(toSummary),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length > 0 ? { cursor: rows[rows.length - 1]!.id } : {}),
      },
    };
  });
}

export async function getMetrics(tenantId: string): Promise<Array<{ label: string; value: string; note?: string }>> {
  const counts = await repo.countTicketsByStatus(tenantId);
  const total = counts.reduce((s, c) => s + c.count, 0);
  const open = counts.find((c) => c.status === "open")?.count ?? 0;
  const closed = counts.find((c) => c.status === "closed")?.count ?? 0;
  return [
    { label: "Total tickets", value: String(total) },
    { label: "Open", value: String(open), note: "Awaiting response" },
    { label: "Closed", value: String(closed) },
  ];
}

export async function getSlaRules(tenantId: string): Promise<Array<{ queue: string; targetDisplay: string; breachedCount: number }>> {
  const generalSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const prioritySince = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const [generalBreached] = await repo.countBreachedTickets(tenantId, generalSince);
  const [priorityBreached] = await repo.countBreachedTickets(tenantId, prioritySince);
  return [
    { queue: "General", targetDisplay: "24h", breachedCount: generalBreached?.count ?? 0 },
    { queue: "Priority", targetDisplay: "4h", breachedCount: priorityBreached?.count ?? 0 },
  ];
}

export async function getTicketAnalytics(tenantId: string) {
  const counts = await repo.countTicketsByStatus(tenantId);
  const total = counts.reduce((s, c) => s + c.count, 0);
  const open = counts.find((c) => c.status === "open")?.count ?? 0;
  const resolved = counts.find((c) => c.status === "resolved")?.count ?? 0;
  const closed = counts.find((c) => c.status === "closed")?.count ?? 0;
  return {
    totalTickets: total,
    openTickets: open,
    resolvedThisMonth: resolved + closed,
    slaBreachedCount: Math.max(0, open - 5),
    avgResolutionHours: 0,
    byPriority: [],
    byChannel: [],
  };
}

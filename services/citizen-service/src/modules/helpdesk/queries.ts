import type { HelpdeskTicketStatus, HelpdeskTicketSummary, TicketDetail } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { TicketRow } from "./schema.js";
import { computeSlaStatus, mapPriority, mapStatus } from "./sla.js";

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
    priority: mapPriority(row.priority) === "critical" ? "Critical"
      : mapPriority(row.priority) === "high" ? "High"
        : mapPriority(row.priority) === "low" ? "Low"
          : "Medium",
    status: mapTicketStatus(row.status),
  };
}

/** Cache JSON-roundtrips Date columns to ISO strings; coerce safely. */
function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toDetail(row: TicketRow, notes: Awaited<ReturnType<typeof repo.listNotes>>): TicketDetail {
  const slaStatus = computeSlaStatus(row);
  const channels = ["web", "email", "phone", "walk_in"] as const;
  const channel: NonNullable<TicketDetail["channel"]> = (channels as readonly string[]).includes(row.channel)
    ? (row.channel as NonNullable<TicketDetail["channel"]>)
    : "web";
  return {
    id: row.id,
    ticketNo: row.ticketNo ?? row.id.slice(0, 8).toUpperCase(),
    subject: row.subject,
    description: row.description,
    requesterName: row.citizenId.slice(0, 8),
    ...(row.assigneeId ? { assignedTo: row.assigneeId } : {}),
    priority: mapPriority(row.priority),
    slaStatus,
    status: mapStatus(row.status),
    channel,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.resolvedAt ? { resolvedAt: toIso(row.resolvedAt) } : {}),
    comments: notes.map((n) => ({
      id: n.id,
      author: n.authorId.slice(0, 8),
      content: n.body,
      createdAt: toIso(n.createdAt),
      isInternal: false,
    })),
  };
}

export async function getTicket(tenantId: string, id: string): Promise<TicketDetail | null> {
  const ticket = await cache.getOrLoad<TicketRow | null>(
    cache.makeKey(tenantId, "ticket", id),
    () => repo.findTicketById(id),
  );
  if (!ticket || ticket.tenantId !== tenantId) return null;
  const notes = await repo.listNotes(id);
  return toDetail(ticket, notes);
}

/** P0-1: ownership-aware fetch — returns the detail plus the owning citizenId. */
export async function getTicketWithOwner(tenantId: string, id: string): Promise<{ detail: TicketDetail; citizenId: string } | null> {
  const ticket = await cache.getOrLoad<TicketRow | null>(
    cache.makeKey(tenantId, "ticket", id),
    () => repo.findTicketById(id),
  );
  if (!ticket || ticket.tenantId !== tenantId) return null;
  const notes = await repo.listNotes(id);
  return { detail: toDetail(ticket, notes), citizenId: ticket.citizenId };
}

export async function listTickets(
  tenantId: string,
  limit: number,
  slaStatus?: string,
  citizenId?: string,
): Promise<{ data: HelpdeskTicketSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  const build = (rows: TicketRow[]) => ({
    data: rows.map(toSummary),
    pagination: {
      hasMore: rows.length === limit,
      pageSize: limit,
      ...(rows.length > 0 ? { cursor: rows[rows.length - 1]!.id } : {}),
    },
  });
  // P0-3: citizen-scoped listing bypasses the shared tenant cache key.
  if (citizenId) {
    return build(await repo.listTicketsByTenant(tenantId, undefined, limit, slaStatus, citizenId));
  }
  const cacheKey = `list:${limit}:${slaStatus ?? "all"}`;
  return cache.listOrLoad(tenantId, "ticket", cacheKey, async () =>
    build(await repo.listTicketsByTenant(tenantId, undefined, limit, slaStatus)),
  );
}

export async function listTicketDetails(
  tenantId: string,
  limit: number,
  slaStatus?: string,
  citizenId?: string,
): Promise<TicketDetail[]> {
  const rows = await repo.listTicketsByTenant(tenantId, undefined, limit, slaStatus, citizenId);
  const details: TicketDetail[] = [];
  for (const row of rows) {
    const notes = await repo.listNotes(row.id);
    details.push(toDetail(row, notes));
  }
  return details;
}

export async function getMetrics(tenantId: string): Promise<Array<{ label: string; value: string; note?: string }>> {
  const counts = await repo.countTicketsByStatus(tenantId);
  const total = counts.reduce((s, c) => s + c.count, 0);
  const open = counts.filter((c) => c.status === "open" || c.status === "in_progress").reduce((s, c) => s + c.count, 0);
  const closed = counts.find((c) => c.status === "closed")?.count ?? 0;
  const breached = await repo.countBreachedTickets(tenantId);
  return [
    { label: "Total tickets", value: String(total) },
    { label: "Open", value: String(open), note: "Awaiting response" },
    { label: "Closed", value: String(closed) },
    { label: "SLA breached", value: String(breached) },
  ];
}

export async function getSlaRules(tenantId: string): Promise<Array<{ queue: string; targetDisplay: string; breachedCount: number }>> {
  const breached = await repo.countBreachedTickets(tenantId);
  return [
    { queue: "Critical/High", targetDisplay: "4–8h", breachedCount: breached },
    { queue: "General", targetDisplay: "24h", breachedCount: breached },
  ];
}

export async function getTicketAnalytics(tenantId: string) {
  const counts = await repo.countTicketsByStatus(tenantId);
  const total = counts.reduce((s, c) => s + c.count, 0);
  const open = counts.filter((c) => c.status === "open" || c.status === "in_progress").reduce((s, c) => s + c.count, 0);
  const resolved = counts.find((c) => c.status === "resolved")?.count ?? 0;
  const closed = counts.find((c) => c.status === "closed")?.count ?? 0;
  const slaBreachedCount = await repo.countBreachedTickets(tenantId);
  return {
    totalTickets: total,
    openTickets: open,
    resolvedThisMonth: resolved + closed,
    slaBreachedCount,
    avgResolutionHours: 0,
    byPriority: [],
    byChannel: [],
  };
}

export { toDetail };

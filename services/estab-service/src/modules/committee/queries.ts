import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { MeetingRow, ComplianceRow } from "./schema.js";

function mapMeetingStatus(status: string): "scheduled" | "in_progress" | "completed" | "cancelled" | "postponed" {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "postponed") return "postponed";
  return "scheduled";
}

function mapMeetingRow(row: MeetingRow) {
  return {
    id: row.id,
    meetingNo: row.id.slice(0, 8).toUpperCase(),
    title: row.title,
    type: "committee" as const,
    scheduledDate: row.whenAt.toISOString().slice(0, 10),
    scheduledTime: row.whenAt.toISOString().slice(11, 16),
    venue: row.venue ?? undefined,
    status: mapMeetingStatus(row.status),
  };
}

export async function getMeetingsByCommittee(tenantId: string, committeeId: string): Promise<MeetingRow[]> {
  const result = await cache.getOrLoad<MeetingRow[]>(
    cache.makeKey(tenantId, "committee_meetings", committeeId),
    () => repo.findMeetingsByCommittee(committeeId, tenantId)
  );
  return result ?? [];
}

export async function listMeetingSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "meetings", `list:${limit}`),
    () => repo.listMeetingsByTenant(tenantId, limit),
  );
  return (rows ?? []).map(mapMeetingRow);
}

export async function getMeetingDetail(id: string, tenantId: string) {
  const row = await repo.findMeetingById(id, tenantId);
  if (!row) return null;
  return { ...mapMeetingRow(row), agenda: [], attendees: [], actionPoints: [] };
}

function mapFrequency(f: string): "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "one_time" {
  if (f === "daily") return "daily";
  if (f === "weekly") return "weekly";
  if (f === "quarterly") return "quarterly";
  if (f === "annual") return "annual";
  if (f === "one_time") return "one_time";
  return "monthly";
}

function mapComplianceStatus(s: string): "pending" | "complied" | "overdue" | "not_applicable" {
  if (s === "complied") return "complied";
  if (s === "overdue") return "overdue";
  if (s === "not_applicable") return "not_applicable";
  return "pending";
}

function mapComplianceRow(row: ComplianceRow) {
  return {
    id: row.id,
    complianceCode: row.complianceCode,
    title: row.title,
    category: row.category,
    frequency: mapFrequency(row.frequency),
    dueDate: row.dueDate,
    assignedTo: row.assignedTo ?? undefined,
    status: mapComplianceStatus(row.status),
    lastCompliedDate: row.lastCompliedDate ?? undefined,
    remarks: row.remarks ?? undefined,
  };
}

export async function listComplianceSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "compliance", `list:${limit}`),
    () => repo.listComplianceItems(tenantId, limit),
  );
  return (rows ?? []).map(mapComplianceRow);
}

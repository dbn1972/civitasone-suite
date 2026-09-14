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

/**
 * `attendeesCount`/`agendaItemsCount` on `MeetingSummarySchema` used to have no backing query
 * at all -- `mapMeetingRow` never set them, and the zod schema's `.default(0)` silently
 * papered over the gap, so the estab/meetings dashboard's "Agenda Items" stat card and the
 * per-row "Attendees" column were ALWAYS 0/blank regardless of real data (found reviewing the
 * frontend fix for the "Agenda Items" stat that was previously showing meetings.length
 * mislabeled -- summing a field that the backend never populated would have been an equally
 * hollow fix). estab-service's own meeting model has no distinct "agenda item" concept (only
 * meeting-service's does); `estab_resolutions` -- already surfaced as `actionPoints` on the
 * single-meeting detail view -- is this feature's real analog of "substantive items attached
 * to a meeting", so that's what backs `agendaItemsCount` here. `attendeesCount` is a straight
 * count of `estab_attendees`.
 */
function mapMeetingRow(
  row: MeetingRow,
  counts: { attendeesCount: number; agendaItemsCount: number } = { attendeesCount: 0, agendaItemsCount: 0 },
) {
  const whenAt = row.whenAt instanceof Date ? new Date(row.whenAt as unknown as string).toISOString() : String(row.whenAt ?? "");
  return {
    id: row.id,
    meetingNo: row.id.slice(0, 8).toUpperCase(),
    title: row.title,
    type: "committee" as const,
    scheduledDate: whenAt.slice(0, 10),
    scheduledTime: whenAt.slice(11, 16),
    venue: row.venue ?? undefined,
    attendeesCount: counts.attendeesCount,
    agendaItemsCount: counts.agendaItemsCount,
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
  const meetingIds = (rows ?? []).map((row) => row.id);
  // PERF-005: was countsForMeeting() -- full-row fetches of attendees AND
  // resolutions, kept only for their .length -- issued once PER meeting row
  // (2N+1). Two grouped-count queries, independent of row count, instead.
  const [attendeeCounts, resolutionCounts] = await Promise.all([
    repo.countAttendeesByMeetingIds(meetingIds, tenantId),
    repo.countResolutionsByMeetingIds(meetingIds, tenantId),
  ]);
  return (rows ?? []).map((row) => mapMeetingRow(row, {
    attendeesCount: attendeeCounts.get(row.id) ?? 0,
    agendaItemsCount: resolutionCounts.get(row.id) ?? 0,
  }));
}

export async function getMeetingDetail(id: string, tenantId: string) {
  const row = await repo.findMeetingById(id, tenantId);
  if (!row) return null;
  const resolutions = await repo.findResolutionsByMeeting(id, tenantId);
  const attendees = await repo.findAttendeesByMeeting(id, tenantId);
  // Map resolution fields to the MeetingDetailSchema actionPoints shape
  const actionPoints = resolutions.map((r) => ({
    id: r.id,
    description: r.body,
    assignedTo: r.actionOwner ?? "unassigned",
    dueDate: r.dueDate ?? undefined,
    status: (r.status === "complied" ? "completed" : "pending") as "pending" | "completed",
  }));
  return {
    ...mapMeetingRow(row, { attendeesCount: attendees.length, agendaItemsCount: resolutions.length }),
    agenda: [],
    // NOTE: the named-attendee roster (name/role, not just a count) is still a separate,
    // unbuilt feature -- estab_attendees only stores a memberRef, not a display name, and
    // resolving that would need a cross-service identity lookup. Left as [] (flagged, not
    // silently built) -- attendeesCount above is real; this array is not.
    attendees: [],
    actionPoints,
  };
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

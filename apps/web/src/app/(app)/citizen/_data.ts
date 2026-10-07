import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

export interface GrievanceSummary {
  id: string;
  grievanceNo: string;
  subject: string;
  complainantName: string;
  category: string;
  status: string;
  createdAt: string;
  dueDate?: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function getArrayPayload(p: unknown): unknown[] | null {
  if (Array.isArray(p)) return p;
  if (isRecord(p) && Array.isArray(p.data)) return p.data;
  if (isRecord(p) && Array.isArray(p.items)) return p.items;
  return null;
}

function mapGrievances(payload: unknown): GrievanceSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: GrievanceSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    if (!id) continue;
    // grievanceNo: use explicit field or fall back to short id
    const grievanceNo =
      toText(row.grievanceNo) ??
      toText(row.grievance_no) ??
      `GRV-${id.slice(0, 8).toUpperCase()}`;
    const subject = toText(row.subject) ?? "—";
    const complainantName =
      toText(row.complainantName) ??
      toText(row.citizenName) ??
      toText(row.applicantName) ??
      "—";
    const category = toText(row.category) ?? "other";
    const status = toText(row.status) ?? "registered";
    const createdAt = toText(row.createdAt) ?? new Date().toISOString();
    // GAP-CITIZEN-GRIEVANCES-02: dueDate is a STATUTORY deadline and must come
    // from the backend (per-category CPGRAMS SLA). Never fabricate it here: a
    // client-invented createdAt+30d would be shown as a real statutory clock
    // and skew overdue counts. Absent => null, rendered as "—"/"SLA not set".
    const dueDate = toText(row.dueDate) ?? toText(row.due_date) ?? null;
    mapped.push({ id, grievanceNo, subject, complainantName, category, status, createdAt, dueDate });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getGrievances(): Promise<LoaderResult<GrievanceSummary[]>> {
  return fetchJson<unknown, GrievanceSummary[]>("/api/v1/citizen/grievances", [], {
    revalidateSeconds: 60,
    telemetryKey: "citizen.grievances",
    mapResponse: mapGrievances,
  });
}

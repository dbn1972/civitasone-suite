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
    // dueDate: 30-day lifecycle from createdAt unless a dueDate field is present
    const dueDate =
      toText(row.dueDate) ??
      toText(row.due_date) ??
      (() => {
        const d = new Date(createdAt);
        if (isNaN(d.getTime())) return null;
        d.setDate(d.getDate() + 30);
        return d.toISOString().slice(0, 10);
      })();
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

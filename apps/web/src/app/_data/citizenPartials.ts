import { fetchJson, type LoaderResult } from "./apiClient";

/** SVC-081/082/084/089 web data loaders (API-only, mirrors citizenGaps.ts). */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function arr(p: unknown): unknown[] {
  if (Array.isArray(p)) return p;
  if (isRecord(p) && Array.isArray(p.data)) return p.data;
  return [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// ─────────────────────────── SVC-081 catalogue ──────────────────────────────
export interface CatalogueService {
  id: string;
  serviceKey: string;
  name: string;
  ownerDepartment: string;
  version: number;
  status: string;
  channels: string[];
  requiredDocumentCount: number;
  slaDays: number | null;
}
export async function getCatalogueServices(): Promise<LoaderResult<CatalogueService[]>> {
  return fetchJson<unknown, CatalogueService[]>("/api/v1/citizen/catalogue/published", [], {
    revalidateSeconds: 30,
    telemetryKey: "citizen.catalogue.published",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        serviceKey: str(r.serviceKey),
        name: str(r.name),
        ownerDepartment: str(r.ownerDepartment),
        version: typeof r.version === "number" ? r.version : 1,
        status: str(r.status) || "published",
        channels: Array.isArray(r.channels) ? r.channels.map(str) : [],
        requiredDocumentCount: Array.isArray(r.requiredDocuments) ? r.requiredDocuments.length : 0,
        slaDays: typeof r.slaDays === "number" ? r.slaDays : null,
      })),
  });
}

// ─────────────────────────── SVC-089 appeals ────────────────────────────────
export interface AppealSummary {
  id: string;
  appealType: string;
  status: string;
  grounds: string;
  filingDeadline: string;
  outcome: string;
}
export async function getAppeals(): Promise<LoaderResult<AppealSummary[]>> {
  return fetchJson<unknown, AppealSummary[]>("/api/v1/citizen/appeals", [], {
    revalidateSeconds: 30,
    telemetryKey: "citizen.appeals",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        appealType: str(r.appealType) || "appeal",
        status: str(r.status) || "filed",
        grounds: str(r.grounds),
        filingDeadline: str(r.filingDeadline),
        outcome: str(r.outcome),
      })),
  });
}

import { fetchJson, type LoaderResult } from "../apiClient";

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

export interface DesignerServiceRow {
  id: string;
  serviceKey: string;
  name: string;
  servicePattern: string;
  ownerDepartment: string;
  version: number;
  status: string;
  updatedAt: string;
}

export interface DomainPackRow {
  id: string;
  domainPackKey: string;
  name: string;
  sector: string;
  jurisdiction: string;
  version: number;
  packCount: number;
}

export async function getDesignerServices(): Promise<LoaderResult<DesignerServiceRow[]>> {
  return fetchJson<unknown, DesignerServiceRow[]>("/api/v1/citizen/catalogue/services", [], {
    revalidateSeconds: 15,
    telemetryKey: "designer.catalogue.services",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        serviceKey: str(r.serviceKey),
        name: str(r.name),
        servicePattern: str(r.servicePattern) || "certificate",
        ownerDepartment: str(r.ownerDepartment),
        version: typeof r.version === "number" ? r.version : 1,
        status: str(r.status) || "draft",
        updatedAt: str(r.updatedAt),
      })),
  });
}

export async function getDomainPacks(): Promise<LoaderResult<DomainPackRow[]>> {
  return fetchJson<unknown, DomainPackRow[]>("/api/v1/citizen/packs/domain", [], {
    revalidateSeconds: 60,
    telemetryKey: "designer.packs.domain",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        domainPackKey: str(r.domainPackKey),
        name: str(r.name),
        sector: str(r.sector),
        jurisdiction: str(r.jurisdiction),
        version: typeof r.version === "number" ? r.version : 1,
        packCount: Array.isArray(r.packKeys) ? r.packKeys.length : 0,
      })),
  });
}

export const SERVICE_PATTERN_OPTIONS = [
  {
    id: "certificate",
    title: "Certificate / Permission",
    description: "Licences, NOCs, registrations, and character certificates.",
    examples: ["Trade License", "Fire NOC", "Birth Certificate"],
    activeBlocks: ["Catalogue", "Form", "Eligibility", "Approval chain", "Fee", "Documents", "Output", "Notifications"],
  },
  {
    id: "booking",
    title: "Booking / Reservation",
    description: "Hall booking, slot allocation, and appointments.",
    examples: ["Community hall", "Vehicle fitness slot", "Registrar appointment"],
    activeBlocks: ["Catalogue", "Form", "Fee", "Documents", "Output", "Notifications"],
  },
  {
    id: "collection",
    title: "Collection (fee-only)",
    description: "Self-assessment and fee payment without an approval gate.",
    examples: ["Property tax", "Amnesty scheme fee", "Professional tax"],
    activeBlocks: ["Catalogue", "Form", "Fee", "Output", "Notifications"],
  },
  {
    id: "grievance",
    title: "Grievance / Case",
    description: "Complaints, service requests, and case tracking.",
    examples: ["PGR complaint", "RTI-adjacent case", "Demand objection"],
    activeBlocks: ["Catalogue", "Form", "Eligibility", "Approval chain", "Documents", "Output", "Notifications"],
  },
] as const;

export const DEFAULT_BLOCKS = [
  { id: "b1", shortLabel: "B1", label: "Catalogue & Identity" },
  { id: "b2", shortLabel: "B2", label: "Intake Form" },
  { id: "b3", shortLabel: "B3", label: "Eligibility" },
  { id: "b4", shortLabel: "B4", label: "Approval Chain" },
  { id: "b5", shortLabel: "B5", label: "Fee & Revenue" },
  { id: "b6", shortLabel: "B6", label: "Documents" },
  { id: "b7", shortLabel: "B7", label: "Output & Issuance" },
  { id: "b8", shortLabel: "B8", label: "Notifications" },
] as const;

/** Blocks hidden per Service Pattern (FN-33 / UX §5.2). */
export function hiddenBlocksForPattern(pattern: string): Set<string> {
  switch (pattern) {
    case "booking":
      return new Set(["b3"]);
    case "collection":
      return new Set(["b3", "b4", "b6"]);
    case "grievance":
      return new Set(["b5"]);
    default:
      return new Set();
  }
}

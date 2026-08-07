import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

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

export {
  SERVICE_PATTERN_OPTIONS,
  DEFAULT_BLOCKS,
  hiddenBlocksForPattern,
} from "./designerConstants";

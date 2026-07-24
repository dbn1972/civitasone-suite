import { fetchJson, type LoaderResult } from "./apiClient";

/** Shared narrowing helpers (local copies so this module is self-contained). */
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

// ─────────────────────────── SVC-083 eligibility ────────────────────────────
export interface EligibilityRuleSet {
  id: string;
  name: string;
  serviceId: string;
  version: number;
  status: string;
  ruleCount: number;
}
export async function getEligibilityRuleSets(): Promise<LoaderResult<EligibilityRuleSet[]>> {
  return fetchJson<unknown, EligibilityRuleSet[]>("/api/v1/citizen/eligibility/rule-sets", [], {
    revalidateSeconds: 30,
    telemetryKey: "citizen.eligibility.ruleSets",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        name: str(r.name),
        serviceId: str(r.serviceId),
        version: typeof r.version === "number" ? r.version : 1,
        status: str(r.status) || "draft",
        ruleCount: Array.isArray(r.rules) ? r.rules.length : 0,
      })),
  });
}

// ─────────────────────────── SVC-085 fee & payment ──────────────────────────
export interface FeeSchedule {
  id: string;
  name: string;
  serviceId: string;
  baseAmount: string;
  currency: string;
  exemptionCount: number;
}
export async function getFeeSchedules(): Promise<LoaderResult<FeeSchedule[]>> {
  return fetchJson<unknown, FeeSchedule[]>("/api/v1/citizen/fees/schedules", [], {
    revalidateSeconds: 30,
    telemetryKey: "citizen.fees.schedules",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        name: str(r.name),
        serviceId: str(r.serviceId),
        baseAmount: str(r.baseAmount) || "0",
        currency: str(r.currency) || "INR",
        exemptionCount: Array.isArray(r.exemptions) ? r.exemptions.length : 0,
      })),
  });
}

// ─────────────────────────── SVC-086 issuance ───────────────────────────────
export interface Certificate {
  id: string;
  certNo: string;
  certType: string;
  status: string;
  validTo: string;
  verifyToken: string;
}
export async function getCertificates(): Promise<LoaderResult<Certificate[]>> {
  return fetchJson<unknown, Certificate[]>("/api/v1/citizen/certificates", [], {
    revalidateSeconds: 30,
    telemetryKey: "citizen.certificates",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        certNo: str(r.certNo) || "—",
        certType: str(r.certType),
        status: str(r.status),
        validTo: str(r.validTo),
        verifyToken: str(r.verifyToken),
      })),
  });
}

// ─────────────────────────── SVC-090 discovery ──────────────────────────────
export interface DiscoveryMatch {
  id: string;
  citizenId: string;
  serviceId: string;
  outcome: string;
  notified: boolean;
  createdAt: string;
}
export async function getDiscoveryMatches(citizenId: string): Promise<LoaderResult<DiscoveryMatch[]>> {
  const q = citizenId ? `?citizenId=${encodeURIComponent(citizenId)}` : "";
  return fetchJson<unknown, DiscoveryMatch[]>(`/api/v1/citizen/discovery/matches${q}`, [], {
    revalidateSeconds: 15,
    telemetryKey: "citizen.discovery.matches",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        citizenId: str(r.citizenId),
        serviceId: str(r.serviceId),
        outcome: str(r.outcome),
        notified: r.notified === true,
        createdAt: str(r.createdAt),
      })),
  });
}

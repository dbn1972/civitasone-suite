/**
 * Tenant slip letterhead (GAP-PAYROLL-SALARY-SLIPS-DETAIL-02).
 *
 * The printable salary slip names the issuing organisation from the tenant's
 * own configuration (GET /v1/payroll/letterhead). When none is configured the
 * slip prints NO authority line -- it never invents one ("Government of India"
 * for every tenant was a fabricated issuer). Server-side module (apiClient
 * uses next/headers); the editing form is the "use client" LetterheadForm.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

export type Letterhead = {
  orgName: string;
  department: string | null;
  ddoName: string | null;
  ddoCode: string | null;
  address: string | null;
  signatoryTitle: string | null;
  showSignatureBlock: boolean;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function mapLetterhead(p: unknown): Letterhead | null | undefined {
  if (!p || typeof p !== "object" || !("data" in p)) return undefined;
  const d = (p as { data: unknown }).data;
  if (d === null) return null;
  if (!d || typeof d !== "object") return undefined;
  const r = d as Record<string, unknown>;
  const orgName = str(r.orgName);
  if (!orgName) return undefined;
  return {
    orgName,
    department: str(r.department),
    ddoName: str(r.ddoName),
    ddoCode: str(r.ddoCode),
    address: str(r.address),
    signatoryTitle: str(r.signatoryTitle),
    showSignatureBlock: r.showSignatureBlock === true,
  };
}

export async function getLetterhead(): Promise<LoaderResult<Letterhead | null>> {
  return fetchJson<unknown, Letterhead | null>("/api/v1/payroll/letterhead", null, {
    telemetryKey: "payroll.letterhead",
    mapResponse: (p) => mapLetterhead(p) ?? null,
  });
}

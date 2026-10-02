export type ClaimDetail = {
  id: string;
  policyId: string;
  assetId: string;
  claimDate: string;
  claimAmountMinor: string;
  settledAmountMinor: string;
  status: string;
  notes: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function minor(v: unknown): string {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
  return "0";
}

export function mapClaimDetail(payload: unknown): ClaimDetail | null {
  if (!isRecord(payload)) return null;
  const { id, policyId } = payload;
  if (typeof id !== "string" || typeof policyId !== "string") return null;
  return {
    id,
    policyId,
    assetId: typeof payload.assetId === "string" ? payload.assetId : "",
    claimDate: typeof payload.claimDate === "string" ? payload.claimDate : "",
    claimAmountMinor: minor(payload.claimAmountMinor),
    settledAmountMinor: minor(payload.settledAmountMinor),
    status: typeof payload.status === "string" ? payload.status : "unknown",
    notes: typeof payload.notes === "string" && payload.notes.trim() ? payload.notes : null,
  };
}

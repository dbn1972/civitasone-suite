export type PolicyDetail = {
  id: string;
  assetId: string;
  policyNo: string;
  insurer: string;
  /** null when the API sent no usable amount -- shown as "—", never as a fabricated 0. */
  coverageMinor: string | null;
  premiumMinor: string | null;
  currency: string;
  startDate: string;
  endDate: string;
  /** null when the policy has no saved reminder -- shown as "Not set", never a default presented as a setting. */
  renewalReminderDays: number | null;
  status: string;
} & Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** GAP-ASSETS-INSURANCE-DETAIL-04: a missing/garbled amount is null, not 0. */
function minorOrNull(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
  return null;
}

export function mapPolicyDetail(payload: unknown): PolicyDetail | null {
  if (!isRecord(payload)) return null;
  const id = payload.id;
  const assetId = payload.assetId;
  const policyNo = payload.policyNo;
  if (typeof id !== "string" || typeof assetId !== "string" || typeof policyNo !== "string") return null;
  return {
    id,
    assetId,
    policyNo,
    insurer: typeof payload.insurer === "string" ? payload.insurer : "—",
    coverageMinor: minorOrNull(payload.coverageMinor),
    premiumMinor: minorOrNull(payload.premiumMinor),
    currency: typeof payload.currency === "string" ? payload.currency : "INR",
    startDate: typeof payload.startDate === "string" ? payload.startDate : "",
    endDate: typeof payload.endDate === "string" ? payload.endDate : "",
    renewalReminderDays: typeof payload.renewalReminderDays === "number" ? payload.renewalReminderDays : null,
    status: typeof payload.status === "string" ? payload.status : "unknown",
  };
}

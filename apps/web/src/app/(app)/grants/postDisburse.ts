import { toHumanError } from "@/lib/messages";

/** Bounds for the clerk-entered sanction / approval reference (mirrors grant-service disburseBody.reason). */
export const RELEASE_REASON_MIN = 3;
export const RELEASE_REASON_MAX = 500;

/**
 * GAP-GRANTS-DETAIL-03: the single place a PFMS release payload is built.
 * The clerk's free-text reason is the AUDIT / approval reference only: it is sent as
 * `reason` and never as `beneficiaryBankRef` (the payee bank-account pointer, which the
 * server resolves from the grantee master). Returns a message when the reason is invalid.
 */
export function validateReleaseReason(reason: string | undefined): string | null {
  const r = (reason ?? "").trim();
  if (r.length < RELEASE_REASON_MIN) return `Enter the sanction or approval reference (at least ${RELEASE_REASON_MIN} characters).`;
  if (r.length > RELEASE_REASON_MAX) return `Keep the reference under ${RELEASE_REASON_MAX} characters.`;
  return null;
}

export async function postDisburse(installmentId: string, reason: string | undefined): Promise<void> {
  const invalid = validateReleaseReason(reason);
  if (invalid) throw new Error(invalid);
  const res = await fetch(`/api/proxy/v1/grants/installments/${installmentId}/disburse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "PFMS", reason: (reason ?? "").trim() }),
  });
  if (!res.ok) {
    const human = toHumanError("save", { area: "grant action" });
    throw new Error(`${human.what} ${human.next}`);
  }
}

export type PfmsBatchRow = {
  id: string;
  pfmsId: string;
  type: string;
  /**
   * Which PFMS submission mechanism produced this row: 'treasury_batch'
   * (batch/DSC-sign/SFTP — this panel's original rows, sign/bank-file apply)
   * or 'ekuber_adapter' (live REST adapter via SubmitPaymentForm — already a
   * completed submission; sign/bank-file do not apply). Both channels are
   * unified into this one list so it answers "was this disbursement actually
   * paid" regardless of which mechanism handled it.
   */
  channel: string;
  /** Minor units (paise) as a string — server emits an exact decimal string, never a Number. */
  amountMinor: string;
  agencyCode: string | null;
  schemeCode: string | null;
  ddoCode: string | null;
  submissionStatus: string;
  signedAt: string | null;
} & Record<string, unknown>;

export type PfmsConfig = {
  agencyCode: string | null;
  defaultDdo: string | null;
  /**
   * State of the e-Kuber payment adapter behind Submit Payment / Payment Status
   * (GAP-FINANCE-PFMS-05). It has NO sandbox: "live" pays for real, "disabled"
   * answers 503. Optional: an older backend omits it -> unknown, never assumed.
   */
  paymentRail?: PfmsPaymentRail;
  /**
   * Mode of the treasury client behind Salary Bill / Payment Advice. This one
   * does have a simulated "sandbox". Separate env family from paymentRail.
   */
  treasuryMode?: PfmsMode;
} & Record<string, unknown>;

export type PfmsPaymentRail = "live" | "disabled";

/**
 * Type guard for the two integration-state fields: anything that is not an
 * exact known value is dropped (-> "unknown" in the UI) instead of being cast
 * through, so a stray string can never be rendered as "live".
 */
export function parsePfmsConfig(p: unknown): PfmsConfig | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  const { paymentRail, treasuryMode, mode: _legacy, ...rest } = r;
  void _legacy;
  return {
    ...rest,
    agencyCode: typeof r.agencyCode === "string" ? r.agencyCode : null,
    defaultDdo: typeof r.defaultDdo === "string" ? r.defaultDdo : null,
    ...(paymentRail === "live" || paymentRail === "disabled" ? { paymentRail } : {}),
    ...(treasuryMode === "sandbox" || treasuryMode === "live" ? { treasuryMode } : {}),
  };
}

/** A bill the payment-advice form can pick (GAP-FINANCE-PFMS-07). `amountMinor` is paise as a digit string. */
export type PfmsBill = {
  id: string;
  billNo: string;
  vendor: string;
  amountMinor: string;
  status: string;
};

export type PfmsSource = "api" | "error";

export type PfmsDepartment = {
  id: string;
  name: string;
};

/**
 * Integration mode a PFMS submission/lookup response reports once the
 * backend PFMS adapter rollout lands (finance-service pfms module —
 * treasury-stubs.ts / adapter-routes.ts). Optional on every response type
 * below because today's stub/adapter responses don't emit it yet; callers
 * must treat its absence as "unknown", not as "live".
 */
export type PfmsMode = "sandbox" | "live";

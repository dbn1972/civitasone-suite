export type PfmsBatchRow = {
  id: string;
  pfmsId: string;
  type: string;
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
} & Record<string, unknown>;

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

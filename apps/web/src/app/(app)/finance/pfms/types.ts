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

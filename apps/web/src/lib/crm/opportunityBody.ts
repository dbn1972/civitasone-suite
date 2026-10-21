/**
 * Wire bodies for `POST /v1/crm/deals` and `PATCH /v1/crm/deals/:id`.
 *
 * The opportunity form works with an `Opportunity` (money as a paise string, every text field a
 * string - blank means "not entered"). crm-service's zod validators (deals/validators.ts) do NOT
 * accept that shape verbatim, so sending `JSON.stringify(opp)` left the real UI unable to save:
 *
 *   - create: `product` is `min(1)` and `expectedCloseDate` is an ISO-date regex, so the blanks
 *     "" the form carries for an untouched field are a 400. Blank optional fields are OMITTED.
 *   - update: `valueMinor` is a JSON NUMBER (a string is a 400) and the optional text fields are
 *     `nullable`, not blank-able, so a cleared field is sent as `null`. Only fields the PATCH
 *     route actually reads are sent (zod strips the rest: name/pipeline/stage move elsewhere).
 *
 * Money stays integer minor units: create carries the exact digit string; update converts to a
 * number ONLY when it is a safe integer, and refuses (never rounds) anything larger.
 *
 * Pure and dependency-free so the contract tests can run the exact body through the real validators.
 */
import type { Opportunity } from "./opportunity";

export interface CreateDealRequest {
  name: string;
  stage?: string;
  pipelineId?: string;
  stageId?: string;
  /** Exact paise digit string (the service accepts it via the money codec). */
  valueMinor: string;
  probability?: number;
  product?: string;
  quantity?: number;
  competitors?: string[];
  nextStep?: string;
  expectedCloseDate?: string;
  accountId?: string;
}

export interface UpdateDealRequest {
  /** Paise as a JSON number: the PATCH validator takes a number, so only safe integers are sent. */
  valueMinor: number;
  product: string | null;
  quantity: number | null;
  competitors: string[];
  nextStep: string | null;
  expectedCloseDate: string | null;
  accountId?: string;
}

const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** The text, trimmed, or undefined when it is blank. */
function text(value: string | undefined): string | undefined {
  const t = (value ?? "").trim();
  return t === "" ? undefined : t;
}

/** Can this paise digit string go through the PATCH validator's JSON number without losing precision? */
export function valueMinorFitsUpdate(valueMinor: string): boolean {
  return /^\d+$/.test(valueMinor) && BigInt(valueMinor) <= MAX_SAFE_MINOR;
}

/** Body for `POST /v1/crm/deals`: blank optional fields are omitted, never sent as "". */
export function buildCreateDealBody(opp: Opportunity): CreateDealRequest {
  const body: CreateDealRequest = { name: opp.name, valueMinor: text(opp.valueMinor) ?? "0" };
  if (opp.stage) body.stage = opp.stage;
  if (opp.pipelineId) body.pipelineId = opp.pipelineId;
  if (opp.stageId) body.stageId = opp.stageId;
  if (opp.probability !== undefined) body.probability = opp.probability;
  const product = text(opp.product);
  if (product !== undefined) body.product = product;
  if (opp.quantity !== undefined) body.quantity = opp.quantity;
  if (opp.competitors.length > 0) body.competitors = opp.competitors;
  const nextStep = text(opp.nextStep);
  if (nextStep !== undefined) body.nextStep = nextStep;
  const expectedCloseDate = text(opp.expectedCloseDate);
  if (expectedCloseDate !== undefined) body.expectedCloseDate = expectedCloseDate;
  if (opp.accountId) body.accountId = opp.accountId;
  return body;
}

/** Body for `PATCH /v1/crm/deals/:id`: a cleared optional field is `null`, the value a safe-integer number. */
export function buildUpdateDealBody(opp: Opportunity): UpdateDealRequest {
  const valueMinor = text(opp.valueMinor) ?? "0";
  if (!valueMinorFitsUpdate(valueMinor)) {
    throw new RangeError("The deal value is too large to save.");
  }
  return {
    valueMinor: Number(valueMinor),
    product: text(opp.product) ?? null,
    quantity: opp.quantity ?? null,
    competitors: opp.competitors,
    nextStep: text(opp.nextStep) ?? null,
    expectedCloseDate: text(opp.expectedCloseDate) ?? null,
    ...(opp.accountId ? { accountId: opp.accountId } : {}),
  };
}

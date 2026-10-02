/**
 * PAY-PROFILES: deputation-order pay terms (migration 0167) -- request schema
 * and the mapping onto lifecycle.hrms_deputations columns. Shared by the
 * depute (create) route, its F3 consumer, and PATCH .../pay-terms so the three
 * cannot drift.
 */
import { z } from "zod";
import type { DeputationInsert, DeputationRow } from "./schema.js";
import { deputationTermsError, moneyTermsOf, changedMoneyFields, type DeputationMoneyTerms } from "../pay-profile/domain.js";
import { toDeputationTerms } from "../pay-profile/repo.js";

const minorString = z.string().regex(/^\d{1,15}$/, "amount in paise as a digit string");

export const payTermsShape = {
  direction: z.enum(["out", "in"]).optional(),
  payOption: z.enum(["parent_scale", "post_scale"]).nullable().optional(),
  stationType: z.enum(["same", "other"]).nullable().optional(),
  parentOrganisation: z.string().min(1).max(200).nullable().optional(),
  parentPayLevel: z.number().int().min(1).max(18).nullable().optional(),
  parentBasicMinor: minorString.nullable().optional(),
  postPayLevel: z.number().int().min(1).max(18).nullable().optional(),
  postBasicMinor: minorString.nullable().optional(),
  allowanceMode: z.enum(["auto", "fixed"]).optional(),
  foreignService: z.boolean().optional(),
  parentPensionScheme: z.enum(["GPF", "NPS", "EPF"]).nullable().optional(),
  daSource: z.enum(["central", "parent"]).optional(),
  parentDaRateBps: z.number().int().min(0).max(100000).nullable().optional(),
};

export const payTermsSchema = z.object(payTermsShape);
export type PayTerms = z.infer<typeof payTermsSchema>;

/** PATCH body: pay terms plus the per-employee allowance override amount. */
export const payTermsPatchSchema = z.object({
  ...payTermsShape,
  deputationAllowanceMinor: minorString.optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field is required" });
export type PayTermsPatch = z.infer<typeof payTermsPatchSchema>;

const big = (v: string | null | undefined): bigint | null | undefined =>
  v === undefined ? undefined : v === null ? null : BigInt(v);

/** Map provided pay-term fields onto Drizzle column values (undefined = untouched). */
export function payTermsColumns(t: PayTerms & { deputationAllowanceMinor?: string | undefined }): Partial<DeputationInsert> {
  const out: Partial<DeputationInsert> = {};
  if (t.direction !== undefined) out.direction = t.direction;
  if (t.payOption !== undefined) out.payOption = t.payOption;
  if (t.stationType !== undefined) out.stationType = t.stationType;
  if (t.parentOrganisation !== undefined) out.parentOrganisation = t.parentOrganisation;
  if (t.parentPayLevel !== undefined) out.parentPayLevel = t.parentPayLevel;
  const pb = big(t.parentBasicMinor); if (pb !== undefined) out.parentBasicMinor = pb;
  if (t.postPayLevel !== undefined) out.postPayLevel = t.postPayLevel;
  const sb = big(t.postBasicMinor); if (sb !== undefined) out.postBasicMinor = sb;
  if (t.allowanceMode !== undefined) out.allowanceMode = t.allowanceMode;
  if (t.foreignService !== undefined) out.foreignService = t.foreignService;
  if (t.parentPensionScheme !== undefined) out.parentPensionScheme = t.parentPensionScheme;
  if (t.daSource !== undefined) out.daSource = t.daSource;
  if (t.parentDaRateBps !== undefined) out.parentDaRateBps = t.parentDaRateBps;
  if (t.deputationAllowanceMinor !== undefined) out.deputationAllowanceMinor = BigInt(t.deputationAllowanceMinor);
  return out;
}

type TermsView = Pick<DeputationRow,
  "direction" | "payOption" | "stationType" | "parentBasicMinor" | "postBasicMinor" | "daSource" | "parentDaRateBps">;

/** Validate the terms that would result from applying `cols` over `base` (null base = new row). */
export function mergedTermsError(base: TermsView | null, cols: Partial<DeputationInsert>): string | null {
  const merged: TermsView = {
    direction: cols.direction ?? base?.direction ?? "out",
    payOption: cols.payOption !== undefined ? cols.payOption ?? null : base?.payOption ?? null,
    stationType: cols.stationType !== undefined ? cols.stationType ?? null : base?.stationType ?? null,
    parentBasicMinor: cols.parentBasicMinor !== undefined ? cols.parentBasicMinor ?? null : base?.parentBasicMinor ?? null,
    postBasicMinor: cols.postBasicMinor !== undefined ? cols.postBasicMinor ?? null : base?.postBasicMinor ?? null,
    daSource: cols.daSource ?? base?.daSource ?? "central",
    parentDaRateBps: cols.parentDaRateBps !== undefined ? cols.parentDaRateBps ?? null : base?.parentDaRateBps ?? null,
  };
  if (base && cols.direction !== undefined && cols.direction !== base.direction) return "DIRECTION_IMMUTABLE";
  return deputationTermsError(merged);
}


/**
 * Money fields a PATCH would change on this deputation (before/after values
 * as stored strings). Non-money fields (parent organisation, foreign-service
 * flag, …) are never in this list.
 */
export function moneyChanges(dep: DeputationRow, cols: Partial<DeputationInsert>): {
  fields: Array<keyof DeputationMoneyTerms>; before: Partial<DeputationMoneyTerms>; after: Partial<DeputationMoneyTerms>;
} {
  const before = moneyTermsOf(toDeputationTerms(dep));
  const after = moneyTermsOf(toDeputationTerms({ ...dep, ...cols } as DeputationRow));
  const fields = changedMoneyFields(before, after);
  const pick = (t: DeputationMoneyTerms) => Object.fromEntries(fields.map((f) => [f, t[f]])) as Partial<DeputationMoneyTerms>;
  return { fields, before: pick(before), after: pick(after) };
}

/** Before/after of every field a PATCH touches (money and non-money), for the audit trail. */
export function patchDiff(dep: DeputationRow, cols: Partial<DeputationInsert>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const s = (v: unknown) => (typeof v === "bigint" ? v.toString() : v ?? null);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cols)) {
    if (k === "updatedBy") continue;
    before[k] = s((dep as unknown as Record<string, unknown>)[k]);
    after[k] = s(v);
  }
  return { before, after };
}

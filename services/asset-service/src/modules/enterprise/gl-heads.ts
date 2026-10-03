/**
 * GL heads for the asset postings that need a per-tenant account (AUC capitalisation, lease recognition).
 * There are NO defaults: a head is configured in asset_settings (validated against finance when set) or the
 * action answers 409 GL_HEADS_NOT_CONFIGURED. Routes pre-flight with `requireGlHeads`; consumers read the
 * same settings row inside their transaction (`headsFromSettings`).
 */
import { HttpError } from "../../shared/context.js";
import { validateHead, type HeadKind, type HeadCheck } from "../../shared/finance-client.js";
import * as repo from "./repo.js";

type SettingsRow = Awaited<ReturnType<typeof repo.getAssetSettings>>;

export const HEAD_COLUMN: Record<HeadKind, "cwipAccountCode" | "fixedAssetAccountCode" | "impairmentExpenseAccountCode" | "revaluationReserveAccountCode" | "rouAccountCode" | "leaseLiabilityAccountCode" | "leaseOffsetAccountCode"> = {
  cwip: "cwipAccountCode",
  fixed_asset: "fixedAssetAccountCode",
  impairment_expense: "impairmentExpenseAccountCode",
  revaluation_reserve: "revaluationReserveAccountCode",
  rou: "rouAccountCode",
  lease_liability: "leaseLiabilityAccountCode",
  lease_offset: "leaseOffsetAccountCode",
};

/** Plain words for each head, used in the 409 message. */
export const HEAD_LABEL: Record<HeadKind, string> = {
  cwip: "capital work in progress",
  fixed_asset: "fixed asset",
  impairment_expense: "impairment loss",
  revaluation_reserve: "revaluation reserve",
  rou: "right-of-use asset",
  lease_liability: "lease liability",
  lease_offset: "lease clearing (initial direct costs / incentives)",
};

export const ALL_HEAD_KINDS: readonly HeadKind[] = ["cwip", "fixed_asset", "impairment_expense", "revaluation_reserve", "rou", "lease_liability", "lease_offset"];

/**
 * No two configured heads may be the same account: Dr X / Cr X would post a silent zero-net journal (e.g. CWIP set to the
 * fixed-asset head leaves CWIP unrelieved). Throws 409 GL_HEAD_INVALID naming the clashing heads.
 */
export function assertDistinctHeads(heads: Partial<Record<HeadKind, string | null | undefined>>): void {
  const seen = new Map<string, HeadKind>();
  for (const k of ALL_HEAD_KINDS) {
    const code = heads[k];
    if (!code) continue;
    const other = seen.get(code);
    if (other) {
      throw new HttpError(409, "GL_HEAD_INVALID",
        `The ${HEAD_LABEL[other]} and ${HEAD_LABEL[k]} accounts are both ${code}. Each GL account must be different, or the journal would net to nothing.`);
    }
    seen.set(code, k);
  }
}

export function headsFromSettings(s: SettingsRow, kinds: readonly HeadKind[]): Partial<Record<HeadKind, string>> {
  const out: Partial<Record<HeadKind, string>> = {};
  for (const k of kinds) {
    const v = s?.[HEAD_COLUMN[k]];
    if (v) out[k] = v;
  }
  return out;
}

export function reasonMessage(kind: HeadKind, code: string, check: Extract<HeadCheck, { ok: false }>): string {
  const what = `${HEAD_LABEL[kind]} account ${code}`;
  switch (check.reason) {
    case "NOT_FOUND": return `The ${what} does not exist in the chart of accounts.`;
    case "INACTIVE": return `The ${what} is inactive in the chart of accounts.`;
    case "WRONG_TYPE": return `The ${what} has the wrong account type (${check.detail ?? "type mismatch"}).`;
    case "ACCUMULATED_DEPRECIATION": return `The ${what} is the accumulated-depreciation account, which cannot be used here.`;
    default: return "The chart of accounts could not be checked right now. Try again shortly.";
  }
}

/**
 * Throws 409 GL_HEADS_NOT_CONFIGURED when any required head is unset, 409 GL_HEAD_INVALID when finance rejects one
 * (missing / inactive / wrong type / accumulated depreciation) and 503 FINANCE_UNAVAILABLE when it cannot be checked.
 * Returns the validated codes.
 */
export async function requireGlHeads(
  tenantId: string, kinds: readonly HeadKind[], correlationId?: string,
): Promise<Record<HeadKind, string>> {
  const settings = await repo.getAssetSettings(tenantId);
  const heads = headsFromSettings(settings, kinds);
  // Distinctness is checked across EVERY configured head, not just the ones this action needs.
  assertDistinctHeads(headsFromSettings(settings, ALL_HEAD_KINDS));
  const missing = kinds.filter((k) => !heads[k]);
  if (missing.length > 0) {
    throw new HttpError(409, "GL_HEADS_NOT_CONFIGURED",
      `GL accounts are not configured: ${missing.map((k) => HEAD_LABEL[k]).join(", ")}. An asset administrator must set them in Asset settings first.`);
  }
  for (const k of kinds) {
    const code = heads[k] as string;
    const check = await validateHead(tenantId, k, code, correlationId);
    if (!check.ok) {
      if (check.reason === "UNAVAILABLE") throw new HttpError(503, "FINANCE_UNAVAILABLE", reasonMessage(k, code, check));
      throw new HttpError(409, "GL_HEAD_INVALID", reasonMessage(k, code, check));
    }
  }
  return heads as Record<HeadKind, string>;
}

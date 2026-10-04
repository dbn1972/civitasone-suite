/**
 * GL heads for the asset postings that need a per-tenant account (AUC capitalisation, lease recognition).
 * There are NO defaults: a head is configured in asset_settings (validated against finance when set) or the
 * action answers 409 ASSET_GL_NOT_CONFIGURED. Routes pre-flight with `requireGlHeads`; consumers read the
 * same settings row inside their transaction (`headsFromSettings`).
 */
import { HttpError } from "../../shared/context.js";
import { validateHead, type HeadKind, type HeadCheck } from "../../shared/finance-client.js";
import * as repo from "./repo.js";

type SettingsRow = Awaited<ReturnType<typeof repo.getAssetSettings>>;

export const HEAD_COLUMN: Record<HeadKind, "cwipAccountCode" | "fixedAssetAccountCode" | "impairmentExpenseAccountCode" | "revaluationReserveAccountCode" | "rouAccountCode" | "leaseLiabilityAccountCode" | "leaseOffsetAccountCode" | "grnClearingAccountCode" | "acquisitionOffsetAccountCode" | "maintenanceExpenseAccountCode" | "apControlAccountCode"> = {
  grn_clearing: "grnClearingAccountCode",
  acquisition_offset: "acquisitionOffsetAccountCode",
  maintenance_expense: "maintenanceExpenseAccountCode",
  ap_control: "apControlAccountCode",
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
  grn_clearing: "goods-received clearing",
  acquisition_offset: "acquisition offset (payable / capital)",
  maintenance_expense: "maintenance expense",
  ap_control: "accounts payable control",
  impairment_expense: "impairment loss",
  revaluation_reserve: "revaluation reserve",
  rou: "right-of-use asset",
  lease_liability: "lease liability",
  lease_offset: "lease clearing (initial direct costs / incentives)",
};

export const ALL_HEAD_KINDS: readonly HeadKind[] = [
  "cwip", "fixed_asset", "impairment_expense", "revaluation_reserve", "rou", "lease_liability", "lease_offset",
  "grn_clearing", "acquisition_offset", "maintenance_expense", "ap_control",
];

/**
 * Catalogued error for a posting that needs a GL account the tenant has not configured. The route pre-flights answer it
 * as a 409 and a record whose journal is deferred carries it in gl_post_error -- always naming the heads.
 */
export const ASSET_GL_NOT_CONFIGURED = "ASSET_GL_NOT_CONFIGURED";

/**
 * Heads that may legitimately be the SAME account: the two credit-side payable roles (a direct acquisition and a
 * maintenance bill both credit accounts payable control). Every other pair must differ, or Dr X / Cr X nets to nothing.
 */
const SHAREABLE: ReadonlyArray<readonly [HeadKind, HeadKind]> = [["acquisition_offset", "ap_control"]];
const mayShare = (a: HeadKind, b: HeadKind): boolean => SHAREABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** The heads each posting area needs; drives the "Accounting not set up" banner and the pre-flights. */
export const AREA_HEADS = {
  acquisition: ["fixed_asset", "acquisition_offset"],
  grn: ["fixed_asset", "grn_clearing"],
  maintenance: ["maintenance_expense", "ap_control"],
  capitalisation: ["cwip", "fixed_asset"],
  leases: ["rou", "lease_liability"],
  impairment: ["fixed_asset", "impairment_expense"],
  revaluation: ["fixed_asset", "revaluation_reserve"],
} as const satisfies Record<string, readonly HeadKind[]>;
export type GlArea = keyof typeof AREA_HEADS;

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
    if (other && !mayShare(other, k)) {
      throw new HttpError(409, "GL_HEAD_INVALID",
        `The ${HEAD_LABEL[other]} and ${HEAD_LABEL[k]} accounts are both ${code}. Each GL account must be different, or the journal would net to nothing.`);
    }
    seen.set(code, k);
  }
}

/** Per posting area: which of its heads are still unset. Pure; used by GET /settings for the "Accounting not set up" banner. */
export function accountingStatus(s: SettingsRow): Record<GlArea, { configured: boolean; missing: HeadKind[] }> {
  const heads = headsFromSettings(s, ALL_HEAD_KINDS);
  const out = {} as Record<GlArea, { configured: boolean; missing: HeadKind[] }>;
  for (const area of Object.keys(AREA_HEADS) as GlArea[]) {
    const missing = (AREA_HEADS[area] as readonly HeadKind[]).filter((k) => !heads[k]);
    out[area] = { configured: missing.length === 0, missing };
  }
  return out;
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
    case "NOT_LEAF": return `The ${what} is a group account, which cannot be posted to. Choose a detail (leaf) account.`;
    case "WRONG_TYPE": return `The ${what} has the wrong account type (${check.detail ?? "type mismatch"}).`;
    case "ACCUMULATED_DEPRECIATION": return `The ${what} is the accumulated-depreciation account, which cannot be used here.`;
    default: return "The chart of accounts could not be checked right now. Try again shortly.";
  }
}

/**
 * Throws 409 ASSET_GL_NOT_CONFIGURED when any required head is unset, 409 GL_HEAD_INVALID when finance rejects one
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
    throw new HttpError(409, ASSET_GL_NOT_CONFIGURED,
      `GL accounts are not configured: ${missing.map((k) => HEAD_LABEL[k]).join(", ")}. An asset administrator must set them in Asset settings first.`,
      { missing });
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

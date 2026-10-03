/** Pure model of GET /v1/asset/settings (asset-service enterprise routes). */
export type HeadField = "cwipAccountCode" | "fixedAssetAccountCode" | "impairmentExpenseAccountCode" | "revaluationReserveAccountCode" | "rouAccountCode" | "leaseLiabilityAccountCode" | "leaseOffsetAccountCode";
export const HEAD_FIELDS: ReadonlyArray<{ field: HeadField; labelKey: "cwip" | "fixedAsset" | "impairmentExpense" | "revaluationReserve" | "rou" | "leaseLiability" | "leaseOffset" }> = [
  { field: "cwipAccountCode", labelKey: "cwip" },
  { field: "fixedAssetAccountCode", labelKey: "fixedAsset" },
  { field: "impairmentExpenseAccountCode", labelKey: "impairmentExpense" },
  { field: "revaluationReserveAccountCode", labelKey: "revaluationReserve" },
  { field: "rouAccountCode", labelKey: "rou" },
  { field: "leaseLiabilityAccountCode", labelKey: "leaseLiability" },
  { field: "leaseOffsetAccountCode", labelKey: "leaseOffset" },
];

export type AssetSettings = {
  capitalizeMakerChecker: boolean;
  heads: Record<HeadField, string | null>;
  pending: { id: string; requestedByMe: boolean } | null;
};

export function parseAssetSettings(payload: unknown): AssetSettings | null {
  if (typeof payload !== "object" || payload === null) return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.capitalizeMakerChecker !== "boolean") return null;
  const head = (k: HeadField): string | null => (typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : null);
  const p = o.pendingMakerCheckerOff;
  const pending = typeof p === "object" && p !== null && typeof (p as { id?: unknown }).id === "string"
    ? { id: (p as { id: string }).id, requestedByMe: (p as { requestedByMe?: unknown }).requestedByMe === true }
    : null;
  return {
    capitalizeMakerChecker: o.capitalizeMakerChecker,
    heads: { cwipAccountCode: head("cwipAccountCode"), fixedAssetAccountCode: head("fixedAssetAccountCode"), impairmentExpenseAccountCode: head("impairmentExpenseAccountCode"), revaluationReserveAccountCode: head("revaluationReserveAccountCode"), rouAccountCode: head("rouAccountCode"), leaseLiabilityAccountCode: head("leaseLiabilityAccountCode"), leaseOffsetAccountCode: head("leaseOffsetAccountCode") },
    pending,
  };
}

const CODE_RE = /^[A-Za-z0-9._-]{1,16}$/;

/**
 * Builds the PATCH body from the edited fields: only heads that CHANGED are sent; an emptied field clears it (null).
 * Returns null when nothing changed or a code is malformed (caller shows the field error).
 */
export function headsPatch(
  current: Record<HeadField, string | null>, edited: Record<HeadField, string>,
): { patch: Partial<Record<HeadField, string | null>>; invalid: HeadField | null } | null {
  const patch: Partial<Record<HeadField, string | null>> = {};
  for (const { field } of HEAD_FIELDS) {
    const next = edited[field].trim();
    if (next === (current[field] ?? "")) continue;
    if (next !== "" && !CODE_RE.test(next)) return { patch: {}, invalid: field };
    patch[field] = next === "" ? null : next;
  }
  return Object.keys(patch).length === 0 ? null : { patch, invalid: null };
}

/**
 * MSME commercial M1 -- fail-closed by CLASSIFICATION (docs/design/MSME-COMMERCIAL.md cross-cutting contract item 5).
 *
 * A tenant whose stored coa_template is `commercial` posts against the commercial chart. If the heads that chart depends on
 * are absent -- or the code exists but with a different classification/purpose (a govt-shaped tenant reusing 2300/3000) --
 * posting is REFUSED, never silently run against the wrong heads. Existence of the CODE alone is not enough.
 *
 * REQUIRED_COMMERCIAL_HEADS is the required-code set: exactly the template-only heads seedGlHeadsTx seeds for `commercial`
 * (docs/design/TENANT-PROFILE-SWITCH.md 2.3), each with the classification it must carry. Core codes (cash, AP, payroll ...)
 * are not listed: they are already refused individually as UNKNOWN_ACCOUNT_CODE by the posting path. tests/msme-m1 asserts
 * this list equals the seed, so the two cannot drift. Keyed on the stored template passed in by the caller, never on edition.
 */
import { and, eq, inArray } from "drizzle-orm";
import { NonRetryableError } from "@civitasone/queue";
import { financeHeads } from "../budget/schema.js";
import { GST_HEADS } from "./gst-heads.js";

/** code -> required classification. 5400 is the default bill head. */
export const REQUIRED_COMMERCIAL_HEADS: Readonly<Record<string, "asset" | "liability" | "equity" | "income" | "expense">> = {
  "5400": "expense",
  "1500": "asset", "1600": "asset", "1700": "asset", "1800": "asset",
  "2300": "liability", "2310": "liability", "2400": "liability", "2500": "liability",
  "3000": "equity", "3200": "equity",
  "4400": "income",
  "5410": "expense", "5420": "expense", "5430": "expense", "5440": "expense", "5450": "expense",
  "6200": "expense",
  // MSME M3a: per-tax ITC heads + RCM heads (the same single definition the seed uses).
  ...Object.fromEntries(GST_HEADS.map((h) => [h.code, h.classification])),
};

/** The refusal code. Matches gl/refusal.ts JOURNAL_* so a journal rejected for it is reported to the producer with this code. */
export const COA_INCOMPLETE_CODE = "JOURNAL_COA_TEMPLATE_INCOMPLETE";

export class CommercialChartIncompleteError extends NonRetryableError {
  readonly code = COA_INCOMPLETE_CODE;
  constructor(readonly problems: string[]) {
    super(`[${COA_INCOMPLETE_CODE}] this tenant uses the commercial chart of accounts but required head(s) are missing or have the wrong classification: ${problems.join(", ")}. Seed the commercial chart before posting`);
    (this as unknown as Error).name = "CommercialChartIncompleteError";
  }
}

/** Pure: the problems (missing / wrong-classification) among `existing` heads against the required set. */
export function commercialChartProblems(existing: Array<{ code: string; classification: string | null }>): string[] {
  const byCode = new Map(existing.map((h) => [h.code, (h.classification ?? "").trim().toLowerCase()]));
  const out: string[] = [];
  for (const [code, want] of Object.entries(REQUIRED_COMMERCIAL_HEADS)) {
    const have = byCode.get(code);
    if (have === undefined) out.push(`${code} missing`);
    else if (have !== want) out.push(`${code} is ${have || "unclassified"}, expected ${want}`);
  }
  return out;
}

/** Throws CommercialChartIncompleteError unless every required commercial head exists with its classification. Run in the tenant's tx (RLS). */
export async function assertCommercialChartReadyTx(tx: unknown, tenantId: string): Promise<void> {
  const rows = await (tx as { select: (c: unknown) => { from: (t: unknown) => { where: (w: unknown) => Promise<Array<{ code: string; classification: string | null }>> } } })
    .select({ code: financeHeads.code, classification: financeHeads.classification })
    .from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.code, Object.keys(REQUIRED_COMMERCIAL_HEADS))));
  const problems = commercialChartProblems(rows);
  if (problems.length > 0) throw new CommercialChartIncompleteError(problems);
}

/**
 * The accounting nature of a GL head, from its code prefix with the stored classification as tie-breaker.
 *
 * One rule for every finance-service read that sorts heads into asset / liability / equity / income / expense:
 * the financial statements (financial-statements/routes.ts natureOf), the statement list (gl/queries.ts) and the
 * dashboard expenditure figure (dashboard/queries.ts). They used to carry their own copies, and the copies drifted
 * (UAT P2 A5: the statement list typed 2202 General Education, an expense head, as a liability).
 *
 * Chart convention (gl/standard-heads.ts): 1xxx asset (including the 'capital' fixed-asset block 1200/1250),
 * 2xxx/3xxx liability unless explicitly classified expense (CGA expenditure heads such as 2202) or equity (3xxx),
 * 4xxx income (4200 gain/loss on disposal is an expense head), 5xxx/6xxx expense.
 */
export type HeadNature = "asset" | "liability" | "equity" | "income" | "expense";

export function headNatureOf(code: string | null | undefined, classification: string | null | undefined): HeadNature {
  const c = code ?? "";
  const cls = classification ?? null;
  const d = c.charAt(0);
  if (d === "1") return "asset";
  if (d === "4" && (cls === "income" || cls === "revenue")) return "income";
  if (d === "5" || d === "6") return "expense";
  if (c === "4200") return "expense"; // gain/loss on disposal
  if (d === "4") return "income";
  if (d === "3" && cls === "equity") return "equity";
  // A CGA expenditure major head (2xxx/3xxx, e.g. 2202 General Education, the default bill head) explicitly classified
  // as an expense is an expense, not a liability: the prefix rule alone put bill expenditure on the liability side.
  if ((d === "2" || d === "3") && (cls === "expense" || cls === "expenditure")) return "expense";
  if (d === "2" || d === "3") return "liability";
  // fall back to the stored classification
  if (cls === "asset") return "asset";
  if (cls === "equity") return "equity";
  if (cls === "income" || cls === "revenue") return "income";
  if (cls === "expense" || cls === "expenditure") return "expense";
  return "liability";
}

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
  const c = (code ?? "").trim();
  // Review follow-up: case and surrounding blanks in the stored classification never change the nature, for every
  // caller (the dashboard passed it raw; the statement list lowercased it first).
  const cls = (classification ?? "").trim().toLowerCase() || null;
  const d = c.charAt(0);
  // #2464 review (LMMH): the major-head range together with the CoA head type. Receipt major heads 0000-1999
  // (Consolidated Fund receipts) classified receipt / revenue / income are INCOME -- never carried forward, their net goes
  // to the fund at year end; this chart also uses 1xxx for assets (1100 cash, 1200 fixed assets), so a 1xxx head of any
  // other type stays an asset. Capital outlay major heads 4000-4999 classified expense / expenditure / capital (as the
  // tenant-onboarding CGA seed types them) are EXPENDITURE, subject to the budget check; 5000-5999 (incl. capital outlay
  // such as 5054) are expenditure by prefix.
  if ((d === "0" || d === "1") && (cls === "receipt" || cls === "receipts" || cls === "revenue" || cls === "income")) return "income";
  if (d === "4" && (cls === "expense" || cls === "expenditure" || cls === "capital" || cls === "capital_outlay")) return "expense";
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

import { z } from "zod";
import {
  zTrimmedText, zTrimmedCode, zIsoDate, DATE_WINDOWS, istToday, yearsFromEnv, boundedMinorNumber, checkMoneyBound, fieldIssue, FIELD_CODES,
} from "@civitasone/schemas/validators";

// UAT T-EDGE bundle 21: text is trimmed and never blank (TE-06), amounts are bounded
// (TE-01 I12: a 1e19 unit price was 202-accepted then dropped by the worker), and the
// required-by date is a real calendar date from today on (TE-01 I01-I03, TE-07 I04).
const itemSchema = z.object({
  itemCode:       zTrimmedCode(64, "item code"),
  description:    zTrimmedText(500, { label: "item description" }),
  quantity:       z.number().int().positive().max(1_000_000_000),
  unit:           zTrimmedText(32, { label: "unit" }).default("nos"),
  unitPriceMinor: z.number().int().nonnegative().superRefine(boundedMinorNumber),
});

/** Indent required-by window: today .. INDENT_REQUIRED_BY_MAX_YEARS (default 3) years ahead. */
export const indentRequiredByWindow = () => DATE_WINDOWS.upcoming(istToday(), yearsFromEnv("INDENT_REQUIRED_BY_MAX_YEARS", 3));

export const createIndentBody = z.object({
  // GAP-PROCUREMENT-INDENTS-NEW-04: indentNo is OPTIONAL — the server always
  // allocates a gapless per-tenant number (indent/consumer.ts allocateDocNo)
  // and ignores any client-supplied value. The web form no longer invents a
  // browser-side "IND-<timestamp>" number; accepting it as optional lets the
  // form stop sending a fabricated one without a 400.
  indentNo:    z.string().min(1).max(64).optional(),
  department:  zTrimmedText(128, { label: "department" }),
  purpose:     zTrimmedText(500, { min: 3, label: "purpose" }),
  sanctionRef: z.string().trim().max(128).optional(),
  requiredBy:  zIsoDate({ window: indentRequiredByWindow, label: "required-by date" }).optional(),
  // GFR procurement-mode (optional): when supplied it is validated against the
  // indent estimated-value band (GFR R.154/155/162/161/166).
  procurementMode: z.enum([
    "direct_purchase", "gem", "limited_tender", "advertised_tender", "single_tender",
  ]).optional(),
  items:       z.array(itemSchema).min(1),
}).superRefine((v, ctx) => {
  // The indent total (sum of quantity x unit price) is stored as one bigint.
  const total = v.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);
  const fail = checkMoneyBound(total);
  if (fail) fieldIssue(ctx, FIELD_CODES.AMOUNT_TOO_LARGE, `indent total ${fail.message}`, ["items"]);
});
export type CreateIndentBody = z.infer<typeof createIndentBody>;

export const approveIndentBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ApproveIndentBody = z.infer<typeof approveIndentBody>;

export const rejectIndentBody = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectIndentBody = z.infer<typeof rejectIndentBody>;

export const indentQueryParams = z.object({ tenantId: z.string().uuid().optional() });
export const idParam = z.object({ id: z.string().uuid() });

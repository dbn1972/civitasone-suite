/**
 * GAP-PAYROLL-TAX-DECLARATION-03: the contract of
 * GET /v1/payroll/tax-declarations?fy=... as the declaration form reads it.
 *
 * Why this exists: the form used to read the response ROOT with no schema, so
 *  - a body wrapped in `{ data: ... }` (the shape the sibling payroll endpoints
 *    use) set every field to blank with no error, and the next save overwrote the
 *    stored declaration with zeros;
 *  - any other object (`{}`, an error envelope served with a 200) was treated as
 *    "a declaration exists" with blank fields.
 * Now the body is unwrapped (root or `{ data }`), validated, and anything that is
 * not a declaration is reported as `invalid` so the form can set its load-failed
 * state (banner + disabled submit) instead of silently showing blanks.
 *
 * UNITS (verified against payroll-service tax/routes.ts GET, createTaxDeclarationBody
 * and the consumer's BigInt(...) writes): every amount below is an integer number of
 * PAISE (minor units) -- including `section80c`, `section80d` and `otherDeductions`,
 * whose names have no `Minor` suffix. `AMOUNT_FIELD_MAP` is the single place that
 * maps the form's field keys to the API's names, for both the GET (prefill) and the
 * POST (save), so a rename on the API side is a one-line change here.
 */
import { z } from "zod";

/** The form's amount fields, in display order. */
export const AMOUNT_FIELDS = [
  "section80c",
  "section80d",
  "otherDeductions",
  "rentPaid",
  "prevEmployerSalary",
  "otherSourcesIncome",
  "perquisites",
] as const;
export type AmountField = (typeof AMOUNT_FIELDS)[number];

/** Form field key -> API field name (GET response and POST body use the same names). All paise. */
export const AMOUNT_FIELD_MAP: Record<AmountField, string> = {
  section80c: "section80c",
  section80d: "section80d",
  otherDeductions: "otherDeductions",
  rentPaid: "rentPaidMinor",
  prevEmployerSalary: "prevEmployerSalaryMinor",
  otherSourcesIncome: "otherSourcesIncomeMinor",
  perquisites: "perquisitesMinor",
};

/** A non-negative integer count of paise: a JSON number, or an all-digits string (bigint columns). */
const paise = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .pipe(z.number().int().nonnegative().safe());

export const taxDeclarationSchema = z.object({
  regime: z.enum(["old", "new"]),
  // The four core amounts are always sent; a body without them is not a declaration.
  section80c: paise,
  section80d: paise,
  otherDeductions: paise,
  rentPaidMinor: paise,
  // Optional on the POST (omitted = nothing declared), so tolerated as absent here
  // (the form shows them blank); a present-but-malformed value is still invalid.
  prevEmployerSalaryMinor: paise.nullish(),
  otherSourcesIncomeMinor: paise.nullish(),
  perquisitesMinor: paise.nullish(),
  status: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  landlordName: z.string().nullish(),
  landlordPanMasked: z.string().nullish(),
});
export type TaxDeclaration = z.infer<typeof taxDeclarationSchema>;

export type ParsedDeclaration =
  | { kind: "none" }
  | { kind: "ok"; declaration: TaxDeclaration }
  | { kind: "invalid" };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Accept either the declaration at the root or wrapped as `{ data: declaration }`
 * (mirrors getArrayPayload in app/_data/apiMappers.ts for the array case). A root
 * object that already carries `regime` is the declaration itself, never unwrapped.
 */
export function unwrapDeclarationPayload(body: unknown): unknown {
  if (isRecord(body) && !("regime" in body) && "data" in body) return body.data;
  return body;
}

/**
 * Classify a GET body: `none` (the API answers `null` when the employee has no
 * declaration for the FY, or `{ data: null }`), `ok` (a valid declaration, root or
 * wrapped) or `invalid` (anything else -- the caller must treat the load as failed).
 */
export function parseTaxDeclarationResponse(body: unknown): ParsedDeclaration {
  const payload = unwrapDeclarationPayload(body);
  if (payload === null || payload === undefined) return { kind: "none" };
  const parsed = taxDeclarationSchema.safeParse(payload);
  return parsed.success ? { kind: "ok", declaration: parsed.data } : { kind: "invalid" };
}

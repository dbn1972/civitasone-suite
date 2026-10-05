/**
 * Field extraction over page text + word boxes. Pure and deterministic.
 * Confidence = OCR word confidence (matching words, else page mean, else 0.6) x validation strength.
 * PII fields (aadhaar, pan, phone, email, account_no) are masked in `raw` AND `value` when the policy
 * action is mask/redact, so extraction output is safe to persist/index.
 */
import type { ExtractedField, FieldKind, PageResult, PiiPolicy, PiiType } from "../types.js";
import { DEFAULT_PII_POLICY } from "../types.js";
import { aadhaarShapedDigits, previewFor, scanAll, type RawMatch, type ScanOptions } from "./patterns.js";
import { locateWords, toPageInput, wordKey, type PageTextInput } from "./wordmap.js";

export interface ExtractOptions extends ScanOptions {
  policy?: PiiPolicy;
}

export const FIELD_PII_TYPE: Partial<Record<FieldKind, PiiType>> = {
  aadhaar: "aadhaar", pan: "pan", phone: "phone", email: "email", account_no: "bank_account",
};

const FALLBACK_OCR_CONF = 0.6;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function extractFields(
  pages: readonly (PageResult | PageTextInput)[],
  opts: ExtractOptions = {},
): ExtractedField[] {
  const policy = opts.policy ?? DEFAULT_PII_POLICY;
  const out: ExtractedField[] = [];
  for (const src of pages) {
    const page = toPageInput(src);
    const matches = scanAll(page.text, opts);
    const occ = new Map<string, number>();
    for (const m of matches) out.push(buildField(page, m, occ, policy));
  }
  return out;
}

function buildField(
  page: PageTextInput,
  m: RawMatch,
  occ: Map<string, number>,
  policy: PiiPolicy,
): ExtractedField {
  const rawText = page.text.slice(m.start, m.end);
  const key = `${m.kind}:${wordKey(rawText)}`;
  const n = occ.get(key) ?? 0;
  occ.set(key, n + 1);
  const hit = page.words ? locateWords(page.words, rawText, n) : null;
  const ocrConf = hit?.confidence ?? (page.meanConfidence && page.meanConfidence > 0 ? page.meanConfidence : FALLBACK_OCR_CONF);
  let confidence = ocrConf * m.validation;
  if (m.kind === "aadhaar" && m.validation < 1) confidence = Math.min(confidence, 0.4);
  let raw = rawText;
  let value = m.value;
  const piiType = FIELD_PII_TYPE[m.kind];
  const act = m.kind === "account_no" && m.value.length === 16 && policy[piiType ?? "bank_account"] === "flag" ? "mask" : piiType ? policy[piiType] : "flag";
  if (piiType && (act === "mask" || act === "redact")) {
    const preview = previewFor(m.kind as "aadhaar" | "pan" | "account_no" | "phone" | "email", m.value);
    raw = preview;
    value = preview.replace(/\s/g, "");
  }
  // Defence in depth (DPDP): any field that is not itself an Aadhaar/PII kind, not produced by a SPECIFIC id label
  // (voucher/bill, file, employee, UTR/invoice) and not a numeric amount/date, but whose value or raw text carries an
  // Aadhaar-shaped number (12 digits starting 2-9, or a 16-digit VID) is masked like an Aadhaar. In practice: generic
  // `Ref No`/`No.` references. The kind is kept; value and raw become the masked preview.
  if (!piiType && !m.specific && m.kind !== "amount_inr" && m.kind !== "date" && policy.aadhaar !== "flag") {
    const digits = aadhaarShapedDigits(value) ?? aadhaarShapedDigits(raw);
    if (digits) {
      const preview = previewFor("aadhaar", digits);
      raw = preview;
      value = preview.replace(/\s/g, "");
    }
  }
  return {
    kind: m.kind, value, raw, confidence: round3(Math.max(0, Math.min(1, confidence))),
    pageNumber: page.pageNumber, bbox: hit?.bbox ?? null,
  };
}

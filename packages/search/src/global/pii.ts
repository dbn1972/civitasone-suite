/**
 * Personal-data guard for the global index. The typed contract (contract.ts) already limits what a producer can
 * send; this is the second line: any string that still LOOKS like a PAN, Aadhaar, bank account, IFSC, e-mail or
 * mobile number is redacted before it is published or indexed, and counted so it can be alerted on.
 */

export const SENSITIVE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "pan", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi },
  { name: "aadhaar", re: /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g },
  { name: "ifsc", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi },
  { name: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { name: "mobile", re: /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g },
  { name: "account-number", re: /(?<!\d)\d{11,18}(?!\d)/g },
];

export const REDACTED = "[redacted]";

/** Names of the sensitive patterns found in `text` (empty when clean). */
export function findSensitive(text: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of SENSITIVE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) hits.push(name);
    re.lastIndex = 0;
  }
  return hits;
}

/** Replace every sensitive-looking substring. Returns the cleaned text and how many substrings were replaced. */
export function redactSensitive(text: string): { text: string; redactions: number } {
  let out = text;
  let redactions = 0;
  for (const { re } of SENSITIVE_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, () => {
      redactions += 1;
      return REDACTED;
    });
  }
  return { text: out, redactions };
}

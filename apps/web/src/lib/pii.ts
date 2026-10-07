/**
 * GAP-AI-COPILOT-02 / GAP-AI-COPILOT-DETAIL-03: lightweight, ADVISORY detection
 * and masking of Indian identity numbers in free text (copilot prompts /
 * responses). This is a best-effort regex pass, NOT a guarantee: it will miss
 * obfuscated or novel formats and must never be presented as a compliance
 * control. The authoritative guardrail runs server-side in ai-agent-service
 * (POST /ask returns 422 GUARDRAIL_BLOCKED); this only helps a user avoid
 * typing sensitive data and reduces casual over-exposure of stored text on the
 * detail screen.
 *
 * Patterns covered (deliberately conservative to limit false positives):
 *  - Aadhaar: 12 digits, optionally grouped 4-4-4 by spaces/hyphens.
 *  - PAN: 5 letters + 4 digits + 1 letter (ABCDE1234F).
 *  - PPO (pension payment order): 12 digits is already covered by Aadhaar;
 *    the common 10/11-digit variants are matched as a long digit run below.
 *  - Bank account: 11-18 digit runs.
 *  - Phone: Indian 10-digit mobile numbers (optionally +91/0 prefixed).
 *  - Email: addresses in free text.
 *
 * GAP-AI-CHAT-DETAIL-02 reuses this to redact citizen chat transcript text at
 * render time so names/PPO/account/phone/email numbers are not shown in the
 * clear to every operator who passes the module gate.
 */

type Matcher = { re: RegExp; mask: (m: string) => string };

function maskKeepingShape(value: string, keepLast = 4): string {
  // Replace every alphanumeric with X except the last `keepLast`, preserving
  // separators (spaces/hyphens) so the shape stays recognisable.
  const chars = [...value];
  const alnumIndexes = chars
    .map((c, i) => (/[0-9a-zA-Z]/.test(c) ? i : -1))
    .filter((i) => i >= 0);
  const keepFrom = alnumIndexes.length - keepLast;
  return chars
    .map((c, i) => {
      if (!/[0-9a-zA-Z]/.test(c)) return c;
      const rank = alnumIndexes.indexOf(i);
      return rank >= keepFrom ? c : "X";
    })
    .join("");
}

// Order matters: PAN (has letters) before the pure-digit runs.
const MATCHERS: Matcher[] = [
  // PAN
  { re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, mask: (m) => `${m.slice(0, 2)}XXXXXX${m.slice(-1)}` },
  // Aadhaar: 12 digits grouped 4-4-4 (spaces or hyphens), or a bare 12-digit run
  { re: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g, mask: (m) => maskKeepingShape(m, 4) },
  // Long digit runs (bare Aadhaar / bank account / PPO): 11-18 digits
  { re: /\b\d{11,18}\b/g, mask: (m) => maskKeepingShape(m, 4) },
  // GAP-AI-CHAT-DETAIL-02: Indian phone numbers (10 digits, optionally prefixed
  // by +91 or 0) — keep the first 2 and last 3 digits.
  { re: /(?:\+91[\s-]?|0)?[6-9]\d{9}\b/g, mask: (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 10) return m;
    const last10 = digits.slice(-10);
    return `${last10.slice(0, 2)}XXXXX${last10.slice(-3)}`;
  }},
  // GAP-AI-CHAT-DETAIL-02: email addresses — mask most of local and domain.
  { re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, mask: (m) => {
    const at = m.indexOf("@");
    if (at <= 0) return "***@***";
    const local = m.slice(0, at);
    const domain = m.slice(at + 1);
    return `${local[0]}***@${domain[0]}***`;
  }},
];

/**
 * True when `text` appears to contain at least one identity number. Advisory.
 */
export function detectIdentifiers(text: string | null | undefined): boolean {
  if (!text) return false;
  return MATCHERS.some((matcher) => {
    matcher.re.lastIndex = 0;
    return matcher.re.test(text);
  });
}

/**
 * Mask any detected identity numbers in `text`, keeping the last 4 characters
 * for recognisability. Advisory — see the module note.
 *
 *   maskIdentifiers("1234 5678 9012")  -> "XXXX XXXX 9012"
 *   maskIdentifiers("PAN ABCDE1234F")  -> "PAN ABXXXXXXF"
 */
export function maskIdentifiers(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const matcher of MATCHERS) {
    matcher.re.lastIndex = 0;
    out = out.replace(matcher.re, (m) => matcher.mask(m));
  }
  return out;
}

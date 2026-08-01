/**
 * guardrails/injection-domain.ts — F.8 prompt-injection defence. Pure functions.
 *
 * Design stance: BE CONSERVATIVE. A false positive costs a citizen one retry
 * with rephrased wording; a false negative can hand an attacker the system
 * prompt, another tenant's context, or an unapproved tool call. When in doubt we
 * flag.
 *
 * The result reports pattern FAMILY NAMES, never the matched text. Matched text
 * is attacker-controlled and may contain personal data, and this result is
 * logged and published to the audit sink (DPDP Act 2023).
 */

export type InjectionSeverity = "low" | "medium" | "high";

export type InjectionFamily =
  | "instruction_override"
  | "role_reassignment"
  | "system_prompt_exfiltration"
  | "delimiter_injection"
  | "encoded_payload"
  | "evasion_hint";

export interface InjectionResult {
  detected: boolean;
  /** Pattern family names, sorted and deduped. Never raw prompt text. */
  patterns: string[];
  severity: InjectionSeverity;
}

/**
 * Families that indicate a direct attempt to take over the model. Any one of
 * them alone is enough for `high`.
 */
const HIGH_FAMILIES: readonly InjectionFamily[] = [
  "instruction_override",
  "role_reassignment",
  "system_prompt_exfiltration",
];

/** Structural attacks. On their own they are `medium`; two together are `high`. */
const MEDIUM_FAMILIES: readonly InjectionFamily[] = ["delimiter_injection", "encoded_payload"];

/**
 * Patterns matched against the NORMALISED text (NFKC, zero-width stripped,
 * lowercased, whitespace collapsed).
 */
const NORMALISED_PATTERNS: ReadonlyArray<{ family: InjectionFamily; regex: RegExp }> = [
  // ── instruction override ──────────────────────────────────────────────────
  { family: "instruction_override", regex: /\b(ignore|disregard|forget|discard|override|bypass)\b[^.!?]{0,40}\b(previous|prior|above|preceding|earlier|initial|original|all)\b[^.!?]{0,40}\b(instruction|instructions|direction|directions|prompt|prompts|rule|rules|guideline|guidelines|context)\b/ },
  { family: "instruction_override", regex: /\b(ignore|disregard|forget)\b[^.!?]{0,20}\b(everything|all)\b[^.!?]{0,20}\b(above|before|previously|you were told)\b/ },
  { family: "instruction_override", regex: /\bnew\s+(instructions?|rules?|system\s+prompt)\s*[:\-—]/ },
  { family: "instruction_override", regex: /\b(start|begin)\s+(over|afresh)\b[^.!?]{0,20}\b(ignore|without)\b/ },
  { family: "instruction_override", regex: /\bthe\s+(above|previous)\s+(instructions?|rules?)\s+(are|were)\s+(wrong|fake|a\s+test|no\s+longer\s+valid)/ },

  // ── role reassignment ─────────────────────────────────────────────────────
  // Contractions matter: "you're now" is the same attack as "you are now".
  { family: "role_reassignment", regex: /\byou\s*(?:are|'re|’re)\s+now\b/ },
  { family: "role_reassignment", regex: /\bfrom\s+now\s+on\s+you\s+(are|will|must|shall)\b/ },
  { family: "role_reassignment", regex: /\b(act|behave)\s+as\s+(a|an|if\s+you)\b/ },
  { family: "role_reassignment", regex: /\bpretend\s+(to\s+be|you\s+are|that\s+you)\b/ },
  { family: "role_reassignment", regex: /\bassume\s+the\s+(role|persona|identity)\s+of\b/ },
  { family: "role_reassignment", regex: /\byour\s+new\s+(role|persona|identity|instructions)\b/ },
  { family: "role_reassignment", regex: /\b(dan\s+mode|do\s+anything\s+now|developer\s+mode\s+(enabled|on)|jailbreak|jailbroken)\b/ },
  { family: "role_reassignment", regex: /\bsimulate\s+(a|an|being)\b[^.!?]{0,30}\b(ai|model|assistant|system)\b/ },

  // ── system prompt exfiltration ────────────────────────────────────────────
  { family: "system_prompt_exfiltration", regex: /\b(repeat|reveal|show|print|output|display|dump|leak|recite|tell\s+me|give\s+me)\b[^.!?]{0,40}\b(system\s+prompt|system\s+message|initial\s+instructions?|original\s+instructions?|your\s+instructions?|your\s+prompt|your\s+rules|your\s+guidelines|hidden\s+prompt)\b/ },
  { family: "system_prompt_exfiltration", regex: /\bwhat\s+(are|were)\s+your\s+(initial|original|system|exact)?\s*(instructions?|prompt|rules|guidelines)\b/ },
  { family: "system_prompt_exfiltration", regex: /\b(everything|all\s+text)\s+(above|before)\s+this\s+(line|message|point)\b/ },
  { family: "system_prompt_exfiltration", regex: /\bverbatim\b[^.!?]{0,30}\b(prompt|instructions?)\b/ },

  // ── delimiter / escape injection ──────────────────────────────────────────
  { family: "delimiter_injection", regex: /<\|[a-z_]+\|>/ },
  { family: "delimiter_injection", regex: /\[\/?(inst|sys|system|assistant|user)\]/ },
  { family: "delimiter_injection", regex: /<<\/?sys>>/ },
  { family: "delimiter_injection", regex: /<\/?(system|assistant|human)>/ },
  { family: "delimiter_injection", regex: /#{2,}\s*(system|instruction|override)\b/ },
  { family: "delimiter_injection", regex: /\b(end\s+of\s+(prompt|instructions?|context))\b/ },
  { family: "delimiter_injection", regex: /(^|\s)(human|assistant|system)\s*:\s*$/ },
  { family: "delimiter_injection", regex: /"""\s*(system|instruction)/ },

  // ── encoded payload markers ───────────────────────────────────────────────
  { family: "encoded_payload", regex: /\bdata:[a-z/+-]+;base64,/ },
  { family: "encoded_payload", regex: /\b(base64|rot13|hex)\s*(encoded|decode[d]?|payload|string)?\s*[:,]/ },
  { family: "encoded_payload", regex: /\b(decode|deobfuscate|unescape)\b[^.!?]{0,30}\b(and|then)\b[^.!?]{0,30}\b(execute|run|follow|obey)\b/ },
  { family: "encoded_payload", regex: /(\\x[0-9a-f]{2}){4,}/ },
  { family: "encoded_payload", regex: /(\\u[0-9a-f]{4}){4,}/ },
  { family: "encoded_payload", regex: /(%[0-9a-f]{2}){6,}/ },

  // ── weak evasion hints (low on their own) ─────────────────────────────────
  { family: "evasion_hint", regex: /\bwithout\s+(any\s+)?(restrictions?|filters?|limits?|censorship)\b/ },
  { family: "evasion_hint", regex: /\b(unfiltered|uncensored|no\s+longer\s+bound|ignore\s+your\s+safety)\b/ },
  { family: "evasion_hint", regex: /\bthis\s+is\s+(just\s+)?(a\s+)?(hypothetical|fiction|role\s*play)\b[^.!?]{0,30}\b(so|therefore)\b/ },
];

/**
 * Patterns matched against the COMPACT form (all non-alphanumerics removed).
 * This is what catches spacing/punctuation obfuscation such as
 * "i g n o r e   p r e v i o u s   i n s t r u c t i o n s" or
 * "ignore-previous-instructions", which the normalised patterns above miss.
 */
const COMPACT_PATTERNS: ReadonlyArray<{ family: InjectionFamily; regex: RegExp }> = [
  { family: "instruction_override", regex: /ignore(all|the)?(previous|prior|above|earlier)(instruction|instructions|prompt|prompts|rules)/ },
  { family: "instruction_override", regex: /disregard(all|the)?(previous|prior|above|earlier)/ },
  { family: "role_reassignment", regex: /youarenow/ },
  { family: "role_reassignment", regex: /donowanything|doanythingnow/ },
  { family: "system_prompt_exfiltration", regex: /(repeat|reveal|show|print|output|dump)(your|the)(system)?(prompt|instructions)/ },
  { family: "system_prompt_exfiltration", regex: /whatis(your|the)systemprompt/ },
];

/** Zero-width and bidi control characters used to hide keywords from naive filters. */
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;

/**
 * Normalise before matching. NFKC folds full-width and other compatibility
 * forms (ｉｇｎｏｒｅ → ignore) so a homoglyph attack does not walk past the
 * regexes, and invisible characters are stripped rather than treated as word
 * boundaries.
 */
export function normalizeForDetection(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Compact form: letters and digits only. Used for de-spacing attacks. */
export function compactForDetection(normalized: string): string {
  return normalized.replace(/[^a-z0-9]/g, "");
}

function severityFor(families: Set<InjectionFamily>): InjectionSeverity {
  if (families.size === 0) return "low";
  for (const f of HIGH_FAMILIES) {
    if (families.has(f)) return "high";
  }
  const mediumHits = MEDIUM_FAMILIES.filter((f) => families.has(f)).length;
  // Two structural attacks together (e.g. a base64 blob wrapped in ChatML
  // delimiters) is a deliberate, engineered payload — treat it as high.
  if (mediumHits >= 2) return "high";
  if (mediumHits === 1) return "medium";
  return "low";
}

/**
 * Detect prompt-injection attempts.
 *
 * Empty or whitespace-only input is never an attack: returns
 * `{ detected: false, patterns: [], severity: "low" }`.
 */
export function detectInjection(text: unknown): InjectionResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { detected: false, patterns: [], severity: "low" };
  }

  const normalized = normalizeForDetection(text);
  const compact = compactForDetection(normalized);
  const families = new Set<InjectionFamily>();

  for (const { family, regex } of NORMALISED_PATTERNS) {
    if (new RegExp(regex.source, regex.flags).test(normalized)) families.add(family);
  }
  for (const { family, regex } of COMPACT_PATTERNS) {
    if (new RegExp(regex.source, regex.flags).test(compact)) families.add(family);
  }

  const patterns = [...families].sort();
  return {
    detected: patterns.length > 0,
    patterns,
    severity: severityFor(families),
  };
}

/** A `high` result blocks the interaction. Single source of truth for the gate. */
export function blocksInteraction(result: InjectionResult): boolean {
  return result.detected && result.severity === "high";
}

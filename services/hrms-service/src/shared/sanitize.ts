// Each pattern is applied repeatedly until the string stops changing: a single pass can be defeated by
// nesting ("<scr<script>ipt>", "javajavascript:script:") because removing the inner match re-forms the
// outer one (CodeQL js/incomplete-multi-character-sanitization).
const STRIP_PATTERNS: readonly RegExp[] = [
  // Whole <script>...</script> blocks incl. newlines in the body and attributes/whitespace in the end tag
  // (CodeQL js/bad-tag-filter: `.` skips newlines and `</script >` was not matched).
  /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi,
  // Any remaining tag (an unterminated <script> opener is removed here).
  /<[^>]+>/g,
  // Script-capable URL schemes: javascript:, vbscript: and data: URIs (CodeQL js/incomplete-url-scheme-check).
  /(?:javascript|vbscript)\s*:/gi,
  /\bdata\s*:(?=[^\s]*[/;,])/gi,
  // Inline event-handler attributes.
  /on\w+\s*=/gi,
];

function stripUntilStable(input: string, pattern: RegExp): string {
  let prev: string;
  let out = input;
  do {
    prev = out;
    out = out.replace(pattern, "");
  } while (out !== prev);
  return out;
}

/** Strip dangerous HTML/script content from string inputs */
export function sanitizeString(val: string): string {
  let out = val;
  let prev: string;
  // Iterate the whole pipeline too: removing a scheme can re-form a tag/handler and vice versa.
  do {
    prev = out;
    for (const pattern of STRIP_PATTERNS) out = stripUntilStable(out, pattern);
  } while (out !== prev);
  return out.trim();
}

/** Deep sanitize all string values in an object */
export function sanitizeInput<T>(obj: T): T {
  if (typeof obj === "string") return sanitizeString(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(sanitizeInput) as unknown as T;
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeInput(v);
    }
    return result as T;
  }
  return obj;
}

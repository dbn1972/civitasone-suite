/**
 * Request-path canonicalisation for the gateway edge.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — an encoded-traversal auth bypass
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Both `proxyHandler` (app.ts) and `jwtEdgeVerify` (jwt-edge.ts) used to decide whether a
 * request was public from `req.url.split("?")[0]` — the RAW, un-normalised path. Node's
 * HTTP parser does not touch percent-encoding, so the string they compared was exactly
 * what the client typed. `fetch()`, however, hands the target to the WHATWG URL parser,
 * which DOES treat `%2e` as a dot for the purposes of dot-segment removal.
 *
 * That gap was an authentication bypass:
 *
 *     POST /api/v1/crm/public/%2e%2e/contacts
 *
 *   * `isPublic` sees a path starting with `/api/v1/crm/public/` → TRUE → the bearer-token
 *     check in proxyHandler is skipped and `jwtEdgeVerify` returns early.
 *   * `resolveRoute` sees the same string → the crm route, remainder
 *     `/public/%2e%2e/contacts`.
 *   * `fetch` then parses `http://crm:3024/v1/crm/public/%2e%2e/contacts`, collapses the
 *     `%2e%2e` into a real `..` segment, and issues `GET /v1/crm/contacts`.
 *
 * An anonymous caller therefore reached an authenticated CRM route through the one
 * public prefix in the gateway. The same trick works with `%2E%2E`, with a literal `..`,
 * and — once `%2f` is in play — with an encoded slash that manufactures a new segment.
 *
 * ── The fix: canonicalise ONCE, reject, never normalise-and-continue ──────────────
 *
 * `canonicalisePath` is called at the very start of the request, and its ONE result feeds
 * every downstream decision (`isPublic`, `resolveRoute`, and jwt-edge's own public check).
 * A single source of truth is the point: two call sites deriving a path independently is
 * precisely how this bug happened.
 *
 * Suspicious paths are REJECTED with 400, not repaired. Normalising and continuing means
 * the gateway forwards a path the client never sent, so what an upstream authorises and
 * what a client asked for diverge again — a smaller version of the same class of bug. A
 * legitimate client has no reason to send a `.` segment, a `..` segment, a backslash, an
 * empty interior segment or an encoded slash to this API: every path parameter here is a
 * uuid, a slug or a hex key.
 */

/** Rejected shapes carry a short machine reason; the client is told nothing specific. */
export type CanonicalPath =
  | { ok: true; pathname: string }
  | { ok: false; reason: string };

/**
 * How many decode passes to attempt before giving up.
 *
 * One pass closes the real attack (`%2e%2e`). Iterating to a fixed point additionally
 * closes the double-encoded variant (`%252e%252e`) in case any layer in front of the
 * gateway — an ALB, an Nginx `rewrite`, a CDN — decodes once before we see it. Bounded so
 * a pathological input cannot loop.
 */
const MAX_DECODE_PASSES = 3;

/** Longest request path (excluding the query string) the edge will route. */
export const MAX_PATH_LENGTH = 2048;

/** C0 controls (incl. NUL, TAB, CR, LF) and DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Decode to a fixed point. Returns null when the encoding is malformed. */
function decodeToFixedPoint(raw: string): string | null {
  let current = raw;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed percent-encoding (a stray "%" or "%zz"). Node forwarded it verbatim and
      // the URL parser would treat it differently again, so it is exactly the kind of
      // divergence this module refuses to reason about.
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Canonicalise the path portion of a raw request URL and pass judgement on it.
 *
 * Note `decodeURIComponent` turns `%2f` into `/`, so an encoded slash shows up here as a
 * genuine extra segment — which is what lets a single segment-structure check cover
 * encoded-slash smuggling as well as dot segments.
 */
export function canonicalisePath(rawUrl: string): CanonicalPath {
  // The query string is split off FIRST and is never inspected below: `%25`, `;` and long
  // values are legitimate there (e.g. `?q=100%25` as a LIKE-wildcard escape).
  const rawPath = rawUrl.split("?")[0] ?? "/";

  // ── Parser-differential rejections (raw path) ────────────────────────────────────
  // Fastify 4 truncates a path at `;` (useSemicolonDelimiter) and decodes once, while this
  // module decodes to a fixed point: `/public/..;/x` and `/public%252fx` therefore look
  // public here and different upstream. Refuse the shapes outright.
  if (rawPath.length > MAX_PATH_LENGTH) return { ok: false, reason: "path_too_long" };
  if (CONTROL_CHARS.test(rawPath)) return { ok: false, reason: "control_char" };
  if (rawPath.includes(";")) return { ok: false, reason: "semicolon" };
  if (/%00/.test(rawPath)) return { ok: false, reason: "null_byte" };

  const decoded = decodeToFixedPoint(rawPath);
  if (decoded === null) {
    // `a%25b` decodes to `a%b`, whose second pass is malformed: still a double encoding.
    return { ok: false, reason: /%25/.test(rawPath) ? "double_encoding" : "malformed_encoding" };
  }

  // Control characters that only appear after decoding (%0a, %09, %0d, %1b ...).
  if (CONTROL_CHARS.test(decoded)) return { ok: false, reason: "control_char" };

  // Backslash: Windows-style separator that some parsers and many upstream frameworks
  // treat as "/". The WHATWG URL parser converts it outright for special schemes.
  if (decoded.includes("\\")) return { ok: false, reason: "backslash_segment" };

  const segments = decoded.split("/");
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === "." || segment === "..") return { ok: false, reason: "dot_segment" };
    // An empty segment is either a leading "/" (i === 0), a trailing "/" (last index), or
    // a "//" in the middle. The first two are ordinary; the third is a normalisation
    // hazard — "//" is where a relative-reference resolver can read the next segment as an
    // authority — and has no legitimate use in this API.
    if (segment === "" && i !== 0 && i !== segments.length - 1) {
      return { ok: false, reason: "empty_segment" };
    }
  }

  /**
   * Encoded slashes are refused rather than accepted-as-decoded. Decisions here are made
   * on the DECODED path while the raw path is what gets forwarded (so upstreams receive
   * byte-for-byte what the client sent). Those two only agree about which route and which
   * prefix apply if decoding cannot change the segment structure — and `%2f` is the one
   * thing that can. Refusing it keeps the guarantee absolute instead of probabilistic.
   */
  if (/%2f/i.test(rawPath)) return { ok: false, reason: "encoded_slash" };

  /**
   * Double encoding. A literal `%` in a path segment is `%25`, and decoding it once more
   * is exactly the step on which this module and a single-decode upstream disagree
   * (`%252f` is "%2f" upstream, "/" here). Every path parameter in this API is a uuid, a
   * slug or a hex key, so a legitimate client never sends one. Checked after the segment
   * rules so double-encoded dot segments keep their more specific `dot_segment` reason.
   */
  if (/%25/.test(rawPath)) return { ok: false, reason: "double_encoding" };

  // Every check passed, so the decoded form has the same segment structure as the raw one.
  return { ok: true, pathname: decoded };
}

/** The one uniform 400 body for a rejected path, so app.ts and jwt-edge.ts cannot drift. */
export const BAD_PATH_RESPONSE = {
  code: "BAD_REQUEST",
  // No echo of the offending path and no mention of which check tripped: a caller probing
  // the guard learns nothing about how the edge normalises.
  message: "malformed request path",
} as const;

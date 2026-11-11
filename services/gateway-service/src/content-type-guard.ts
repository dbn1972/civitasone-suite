/**
 * Content-Type allow-list for body-carrying methods at the gateway edge.
 *
 * Fastify already answers 415 for a media type with no registered parser; this makes the
 * allow-list explicit and also refuses header values a parser might read leniently
 * (control characters such as TAB/CR/LF, which have no place in a media type).
 *
 * Allowed on POST/PUT/PATCH:
 *   - application/json            (optional charset parameter only)
 *   - multipart/form-data         (boundary required)
 *   - text/plain                  (optional charset)
 *   - application/x-www-form-urlencoded ONLY under the carrier/payment webhook prefixes,
 *     whose scoped raw-string parser (app.ts) is the one place the gateway expects it.
 * A request with NO content-type is left to Fastify (bodyless POST/DELETE are normal; a
 * body without a type is still answered 415 by Fastify itself).
 */

export type ContentTypeVerdict = { ok: true } | { ok: false; reason: string };

export const UNSUPPORTED_MEDIA_RESPONSE = {
  code: "UNSUPPORTED_MEDIA_TYPE",
  message: "unsupported content-type",
} as const;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CHARSET_ONLY = /^\s*charset\s*=\s*("?)[A-Za-z0-9._:-]{1,40}\1\s*$/i;
const BOUNDARY = /^\s*boundary\s*=\s*(?:"[^"\r\n]{1,70}"|[^\s";,]{1,70})\s*$/i;

export function checkBodyContentType(
  method: string,
  header: string | string[] | undefined,
  rawUrl: string,
  formUrlencodedPrefixes: readonly string[],
): ContentTypeVerdict {
  if (!BODY_METHODS.has(method.toUpperCase())) return { ok: true };
  if (header === undefined) return { ok: true };
  if (Array.isArray(header)) return { ok: false, reason: "multiple_content_type" };
  if (CONTROL_CHARS.test(header)) return { ok: false, reason: "control_char" };

  const [mediaRaw = "", ...params] = header.split(";");
  const media = mediaRaw.trim().toLowerCase();

  switch (media) {
    case "application/json":
    case "text/plain":
      return params.every((p) => CHARSET_ONLY.test(p))
        ? { ok: true }
        : { ok: false, reason: "bad_parameters" };
    case "multipart/form-data": {
      const hasBoundary = params.some((p) => BOUNDARY.test(p));
      return hasBoundary ? { ok: true } : { ok: false, reason: "missing_boundary" };
    }
    case "application/x-www-form-urlencoded": {
      const path = rawUrl.split("?")[0] ?? "";
      const onWebhook = formUrlencodedPrefixes.some((p) => path === p || path.startsWith(p + "/"));
      if (!onWebhook) return { ok: false, reason: "form_urlencoded_not_expected" };
      return params.every((p) => CHARSET_ONLY.test(p))
        ? { ok: true }
        : { ok: false, reason: "bad_parameters" };
    }
    default:
      return { ok: false, reason: "unsupported_media_type" };
  }
}

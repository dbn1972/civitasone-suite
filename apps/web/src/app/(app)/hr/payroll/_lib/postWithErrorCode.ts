import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

/**
 * POST through the BFF proxy and, on failure, let the caller turn a KNOWN
 * payroll-service error `code` (e.g. "PT_SLAB_OVERLAP", "DUPLICATE_CHALLAN",
 * "SELF_APPROVAL_FORBIDDEN") into its own translated, field-specific
 * sentence. Any other failure falls back to browserJson's catalogued generic
 * message (errorMessageFromResponse) — the backend's raw `message` text is
 * never shown (UX-020).
 *
 * `codeMessages` maps code → already-translated display text.
 * `opts.area` is an optional plain noun ("professional tax slab") that makes the
 * generic fallback specific. The fallback is the app-wide status-aware standard
 * (apps/web/docs/ERROR-MESSAGES.md) for every caller; `opts.statusAware` is a
 * deprecated no-op kept so call sites written against the old opt-in still compile.
 */
export type ErrorCodeOptions = { area?: string; /** @deprecated status-aware is now the default. */ statusAware?: boolean };
export async function postWithErrorCode<T = unknown>(
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts: ErrorCodeOptions = {},
): Promise<T> {
  const res = await browserFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (res.ok) return (await res.json().catch(() => ({}))) as T;
  let code: string | undefined;
  try {
    const parsed = (await res.clone().json()) as { code?: unknown };
    code = typeof parsed?.code === "string" ? parsed.code : undefined;
  } catch {
    code = undefined;
  }
  if (code && Object.prototype.hasOwnProperty.call(codeMessages, code)) {
    throw new Error(codeMessages[code]);
  }
  throw new Error(await errorMessageFromResponse(res, undefined, opts.area));
}

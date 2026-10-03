import { browserFetch, errorMessageFromResponse, errorMessageForStatus } from "@/lib/api/browserClient";

/**
 * Send a request through the BFF proxy and, on failure, let the caller turn a
 * KNOWN payroll-service error `code` (e.g. "PT_SLAB_OVERLAP",
 * "DUPLICATE_CHALLAN", "SELF_APPROVAL_FORBIDDEN") into its own translated,
 * field-specific sentence. Any other failure falls back to browserJson's
 * catalogued generic message (errorMessageFromResponse) -- the backend's raw
 * `message` text is never shown (UX-020).
 *
 * `codeMessages` maps code -> already-translated display text. `opts.area` is
 * an optional plain noun ("professional tax slab") that makes the generic
 * "couldn't save your ..." fallback specific; `opts.statusAware` (opt-in) makes
 * a 403 read as a permission problem and a 400/422 as "values not accepted"
 * instead of the generic save failure (GAP-PAYROLL-STATUTORY-PT-06).
 */
export type ErrorCodeOptions = { area?: string; statusAware?: boolean };

export async function requestWithErrorCode<T = unknown>(
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts: ErrorCodeOptions = {},
): Promise<T> {
  const res = await browserFetch(path, { method, body: JSON.stringify(body) });
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
  throw new Error(opts.statusAware ? await errorMessageForStatus(res, opts.area) : await errorMessageFromResponse(res, undefined, opts.area));
}

export function postWithErrorCode<T = unknown>(
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts?: ErrorCodeOptions,
): Promise<T> {
  return requestWithErrorCode<T>("POST", path, body, codeMessages, opts);
}

export function patchWithErrorCode<T = unknown>(
  path: string,
  body: unknown,
  codeMessages: Record<string, string>,
  opts?: ErrorCodeOptions,
): Promise<T> {
  return requestWithErrorCode<T>("PATCH", path, body, codeMessages, opts);
}

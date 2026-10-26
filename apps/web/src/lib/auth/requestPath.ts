// Next 15: headers() is async. Layouts here are synchronous, so this uses the same
// supported transitional UnsafeUnwrappedHeaders cast roleGuard uses for cookies().
import { headers, type UnsafeUnwrappedHeaders } from "next/headers";

/**
 * The pathname of the current request, as stamped by middleware (x-pathname is
 * always overwritten there, so a client-supplied value never reaches a layout).
 * Null outside a request scope (unit tests) or when the header is absent; callers
 * must then fall back to their STRICTEST role set.
 */
export function getRequestPathname(): string | null {
  try {
    const v = (headers() as unknown as UnsafeUnwrappedHeaders).get("x-pathname");
    return v && v.startsWith("/") ? v : null;
  } catch {
    return null;
  }
}

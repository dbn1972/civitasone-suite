import { errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";

/**
 * GAP-ASSETS-BULK-IMPORT-05: a failed bulk import is shown as plain copy --
 * never the raw response body. The one server sentence we do quote is the
 * DUPLICATE_CODE message, which asset-service builds only from the asset codes
 * the clerk themselves submitted.
 */
export async function bulkImportErrorMessage(res: Response): Promise<string> {
  const code = await errorCodeFromResponse(res);
  if (code === "DUPLICATE_CODE") {
    try {
      const body = (await res.clone().json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message) {
        return `Some asset codes are already in use: ${body.message.replace(/^[^:]*:\s*/, "")}. Change or remove them and try again.`;
      }
    } catch { /* fall through to the generic copy */ }
  }
  if (res.status === 403) {
    const h = toHumanError("forbidden");
    return `${h.what} ${h.next}`;
  }
  return errorMessageFromResponse(res, "save", "asset import");
}

/**
 * GAP-ASSETS-BULK-IMPORT-04: one Idempotency-Key per distinct CSV, reused when
 * the same file is re-submitted (a double click or a retry after a timeout), so
 * asset-service dedupes it instead of creating the assets twice.
 */
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* insecure context */ }
  return `bulk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

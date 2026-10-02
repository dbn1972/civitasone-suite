import { toHumanError } from "@/lib/messages";

/**
 * GAP-ASSETS-SCAN-02: map a failed scan-lookup HTTP status to plain-language
 * copy. Only a 404 means "no asset with this tag"; a permission or server
 * failure must never be reported as an unknown tag.
 */
export function scanFailureMessage(status: number): { message: string; retryable: boolean } {
  if (status === 404) return { message: "No asset with this tag. Check the tag and try again.", retryable: false };
  if (status === 401 || status === 403) {
    const h = toHumanError("forbidden", { area: "asset lookup" });
    return { message: `${h.what} ${h.next}`, retryable: false };
  }
  const h = toHumanError("load", { area: "asset" });
  return { message: `${h.what} ${h.next}`, retryable: true };
}

/** Network failure (offline / DNS / aborted): never echo the browser's raw message. */
export function scanNetworkMessage(): string {
  const h = toHumanError("offline", { area: "asset" });
  return `${h.what} ${h.next}`;
}

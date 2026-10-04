/**
 * Browser-side calls for the inventory <-> stock item cross-reference, through the BFF proxy.
 * Both mutations are queued by the service (202). The proxy and gateway forward only
 * `x-idempotency-key`, so that is the header sent; a fresh key per user action means a
 * deliberate repeat (link, unlink, link again) is never swallowed as a duplicate.
 */
function idempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function postItemLink(inventoryItemId: string, stockItemId: string, source: "manual" | "suggested"): Promise<Response> {
  return fetch("/api/proxy/v1/inventory/item-links", {
    method: "POST",
    headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey() },
    body: JSON.stringify({ inventoryItemId, stockItemId, source }),
  });
}

export function deleteItemLink(linkId: string): Promise<Response> {
  return fetch(`/api/proxy/v1/inventory/item-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
    headers: { "x-idempotency-key": idempotencyKey() },
  });
}

/** The service applies a queued command a moment later; refresh after this delay so the new state shows. */
export const LINK_REFRESH_DELAY_MS = 900;

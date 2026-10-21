/**
 * GAP-HR-TRAVEL-02: /hr/travel links an APPROVED request to
 * /hr/expenses?travelRequestId=<id> so the claim form can send it as
 * travelRequestId (POST /v1/hrms/expenses already accepts it and re-checks
 * server-side that the request is the caller's own, in this tenant).
 *
 * The id comes from the URL, so it is validated as a UUID before it is used
 * anywhere; anything else (missing, repeated param, junk) means "no link".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTravelRequestId(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  return UUID.test(raw) ? raw : undefined;
}

import { PO_STATUS_LABELS } from "@/lib/procurement-status";

/**
 * GAP-PROCUREMENT-DASHBOARD-02: the dashboard counters are a "snapshot of
 * pending actions", so each must drill into the list it counts. The filter a
 * counter links to has to select EXACTLY the rows the counter counted, so the
 * definitions live here, next to the pages that parse them, and are mirrored
 * from procurement-service dashboard/queries.ts:
 *
 *   pendingIndents -> indents whose status is draft OR pending (the API maps the
 *                     raw `pending` to `pending_approval` for the list page);
 *   activePOs      -> purchase orders whose status is approved.
 */

/** List-page indent statuses behind the "Pending Indents" counter (draft + pending). */
export const PENDING_INDENT_STATUSES = ["draft", "pending_approval"] as const;

/** PO status behind the "Active POs" counter. */
export const ACTIVE_PO_STATUS = "approved";

export const PENDING_INDENTS_HREF = `/procurement/indents?status=${PENDING_INDENT_STATUSES.join(",")}`;
export const ACTIVE_POS_HREF = `/procurement/orders?status=${ACTIVE_PO_STATUS}`;
/**
 * Renewals are tracked in contract-service and the renewal window is an open
 * owner decision, so the card opens the contracts register itself (its Expires
 * column and "Expiring soon" cue show what is lapsing) instead of a filter that
 * does not exist.
 */
export const CONTRACTS_REGISTER_HREF = "/contracts/list";

/**
 * Parse an indents `?status=` value: one status or a comma-separated set. The
 * raw service status `pending` (what older links carried) means the list page's
 * `pending_approval`. Unknown values are kept so the page can say "no indents in
 * this status" rather than silently ignoring a filter.
 */
export function parseIndentStatusFilter(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const mapped = s === "pending" ? "pending_approval" : s;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * The raw procurement-service indent status behind a list-page status. The list
 * shows the service's `pending` as `pending_approval` (apiMappers); every other
 * list status is the service status itself.
 */
export function indentServiceStatus(listStatus: string): string {
  return listStatus === "pending_approval" ? "pending" : listStatus;
}

/**
 * The `status` query value to send to the indents list API for a parsed
 * `?status=` filter: raw service statuses, comma-separated, so the server
 * filters BEFORE paging (a status filter applied to one fetched page would hide
 * matching indents that sit on later pages). Undefined when there is no filter.
 */
export function indentServiceStatusQuery(listStatuses: readonly string[]): string | undefined {
  if (listStatuses.length === 0) return undefined;
  return listStatuses.map(indentServiceStatus).join(",");
}

/**
 * Parse an orders `?status=` value into a known PO status key, or undefined
 * (show all). `active` is what the first version of the dashboard link carried;
 * it means `approved`.
 */
export function parsePoStatusParam(raw: string | undefined): string | undefined {
  const s = raw?.trim().toLowerCase();
  if (!s) return undefined;
  const key = s === "active" ? ACTIVE_PO_STATUS : s;
  return Object.prototype.hasOwnProperty.call(PO_STATUS_LABELS, key) ? key : undefined;
}

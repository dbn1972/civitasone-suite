// Server-safe (no "use client"): the list page (a server component) imports these.
// They previously lived in LegalCasesTable.tsx, a client module, so on the server the
// import resolved to a client reference and `items.filter(isWritOrCriminal)` threw
// "TypeError: object is not a function", failing the /legal/list render in the
// production build.

/**
 * GAP-LEGAL-LIST-02: the set of case statuses that count as a live/active
 * matter. "pending", "appealed" and "stayed" are all still-open; disposed /
 * settled are terminal. Exported so the list page's "Active Cases" card and
 * any table-side logic share one definition and cannot drift.
 */
export const ACTIVE_CASE_STATUSES: readonly string[] = ["pending", "appealed", "stayed"];

/**
 * GAP-LEGAL-LIST-01: a writ or criminal matter is a CASE CATEGORY, not a
 * computed risk assessment. This single predicate backs both the list page's
 * "Writ / Criminal" stat card and the table's "Writ & criminal" filter so the
 * two counts are guaranteed to agree.
 */
export function isWritOrCriminal(c: { type: string }): boolean {
  return c.type === "writ" || c.type === "criminal";
}

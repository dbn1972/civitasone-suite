/**
 * GAP-HR-SERVICE-BOOK-03/05: the entry-type vocabulary was open (varchar(30)
 * + z.string()) while ServiceBookView's badge map only knew 11 keys and the
 * tenant-wide list page's stat counters matched only 4 literal strings —
 * every real consumer (deputation, training, pay-matrix, lifecycle) writes
 * more values than either side accounted for. This is the single source of
 * truth for the backend (entryType enum on the manual-POST route,
 * aggregate stat counts on the list route); the web side keeps its own,
 * deliberately duplicated copy at apps/web/src/lib/serviceBookEventTypes.ts
 * (cross-package boundary — web cannot import a service's module file) and
 * must be kept in sync with this list by hand.
 */
export const SERVICE_BOOK_EVENT_TYPES = [
  "join",
  "transfer",
  "posting",
  "promotion",
  "increment",
  "leave",
  "deputation_out",
  "repatriation",
  "deputation_cancelled",
  "confirmation",
  "suspension",
  "separation",
  "reinstatement",
  "training",
  "retirement",
  "other",
] as const;

export type ServiceBookEventType = (typeof SERVICE_BOOK_EVENT_TYPES)[number];

// Buckets the tenant-wide list page's "Transfers / Postings" and
// "Promotions / Increments" stat cards count against (GAP-HR-SERVICE-BOOK-05).
export const SERVICE_BOOK_TRANSFER_TYPES = ["transfer", "posting"] as const;
export const SERVICE_BOOK_PROMOTION_TYPES = ["promotion", "increment"] as const;

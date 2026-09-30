/**
 * GAP-HR-SERVICE-BOOK-03/05: mirrors services/hrms-service/src/modules/
 * service-book/constants.ts one-for-one. Kept as a separate, hand-synced
 * copy (not a shared import) because apps/web and services/hrms-service are
 * different packages/runtimes -- the web app never imports a service's
 * module file. Update both files together.
 */
export const SERVICE_BOOK_TRANSFER_TYPES = ["transfer", "posting"] as const;
export const SERVICE_BOOK_PROMOTION_TYPES = ["promotion", "increment"] as const;

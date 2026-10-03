/**
 * Page size of the tenant-wide substitutes read (GET /v1/inventory/substitutes).
 * The service caps a page at 200 rows; a full page is reported as possibly
 * incomplete. Client-safe: no server imports.
 */
export const SUBSTITUTES_PAGE_LIMIT = 200;

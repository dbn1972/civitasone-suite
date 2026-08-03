/**
 * CAP-052 — catalogue DB re-export.
 * Canonical createTenantDb surface lives in shared/db.ts (F6 fleet pattern).
 */
export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } from "../../shared/db.js";
export type { Db } from "../../shared/db.js";

/**
 * GAP-GRANTS-APPLICATIONS-02: the real application-stage statuses the list can
 * be filtered by (NOT the old bogus "pending"). Shared by the Server Component
 * page (which validates ?status= with z.enum) and the client FilterButton.
 *
 * Deliberately a plain module, not the "use client" FilterButton.tsx: imported
 * from a client module, the array is a client reference on the server, and
 * z.enum(APPLICATION_FILTERS) threw "array.map is not a function" while the
 * page rendered, crashing /grants/applications (UAT L1, Phase 1B).
 */
export const APPLICATION_FILTERS = ["submitted", "under_review", "approved", "rejected", "withdrawn"] as const;
export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number];

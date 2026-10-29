/**
 * finance-worker (UAT 2026-10-29) logged every 5 minutes:
 *   "PFMS release sweeper failed" TypeError [ERR_INVALID_ARG_TYPE] ... Received an instance of Date
 * from findStuckViaScanner (pfms/release.ts): the cutoff Date was bound raw into an untyped
 * COALESCE(...) < $1 comparison on the scanner pool, which postgres-js could not serialize, so the
 * stuck-release sweeper never ran. Exercise the REAL default finder (no findStuck override) against
 * real Postgres.
 */
import { describe, it, expect, afterAll } from "vitest";
import { sqlClient } from "../src/shared/db.js";

const { sweepStuckReleases } = await import("../src/modules/pfms/release.js");

afterAll(async () => {
  const { scannerSqlClient } = await import("../src/shared/scanner-db.js");
  await scannerSqlClient.end();
  await sqlClient.end();
});

describe("PFMS stuck-release sweeper default finder", () => {
  it("runs the cross-tenant scan without a Date serialization TypeError", async () => {
    await expect(sweepStuckReleases({ now: new Date("2000-01-01T00:00:00Z") })).resolves.toBe(0);
  });
});

/**
 * Regression test for outbox_relay_cycle_failed (Postgres 42704
 * "unrecognized configuration parameter app.tenant_id").
 *
 * ROOT CAUSE (see migrations/0004_outbox_inbox_durable.sql for the full
 * writeup): rates.current_tenant_id() used to call
 * current_setting('app.tenant_id', false) — missing_ok=false — so it RAISED
 * instead of returning NULL when no GUC was set. The transactional-outbox
 * relay (@civitasone/outbox startRelay/relayOnce) is deliberately
 * tenant-agnostic: it polls ALL unpublished rows across every tenant in one
 * query and never sets app.tenant_id. Every relay cycle for revenue_svc
 * (a NOBYPASSRLS role) crashed against _outbox.messages' FORCE RLS policy.
 *
 * This is a REAL integration test against the live database (not a mock) —
 * the bug is specifically about Postgres GUC/RLS behaviour, which a fake
 * Drizzle handle cannot reproduce. It connects with the exact same `db`
 * handle worker.ts hands to startRelay(), with no tenant context set, mirroring
 * the relay's real invocation exactly.
 *
 * Requires a live Postgres reachable at DATABASE_URL (see vitest.config.ts —
 * defaults to the dev civitas_revenue DB), migrated at least through
 * 0004_outbox_inbox_durable.sql.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { relayOnce } from "@civitasone/outbox";
import { db } from "../src/shared/db.js";

describe("outbox relay — RLS/GUC regression (revenue-service)", () => {
  it("rates.current_tenant_id() is NULL-safe: returns NULL instead of raising 42704 when app.tenant_id is unset", async () => {
    // A fresh connection/session never had app.tenant_id set on it. The
    // postgres-js driver's db.execute() result is array-like (rows indexed
    // directly), not wrapped in a  property.
    const result = await db.execute(sql`SELECT rates.current_tenant_id() AS tenant_id`);
    const rows = result as unknown as Array<{ tenant_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBeNull();
  });

  it("a tenant-agnostic SELECT against _outbox.messages does not throw 42704 with no GUC set", async () => {
    // This is exactly the query relayOnce() runs every cycle. Before the fix,
    // this line threw PostgresError 42704 for every single relay tick.
    await expect(
      db.execute(sql`SELECT count(*) FROM _outbox.messages WHERE published_at IS NULL`),
    ).resolves.toBeDefined();
  });

  it("relayOnce() completes a full cycle without throwing when no tenant GUC is set", async () => {
    // A no-op queue: relayOnce should reach (and return from) its outbox
    // SELECT without ever needing to actually publish anything for this
    // assertion to be meaningful — an empty/zero result is fine, a thrown
    // PostgresError 42704 is the regression this guards against.
    const noopQueue = { publish: async () => {} } as Parameters<typeof relayOnce>[1];
    await expect(relayOnce(db, noopQueue, 10, "revenue-service-test")).resolves.toEqual(expect.any(Number));
  });

  it("_outbox.messages has no FORCE ROW LEVEL SECURITY (the relay table is intentionally RLS-free)", async () => {
    // Matches inspection-service's demonstrably-working pattern (verified live:
    // inspection's outbox has a genuine published/unpublished mix, proving its
    // relay actually delivers, whereas services that kept FORCE RLS + a
    // NULL-safe function merely stopped crashing while silently publishing
    // nothing — every row is filtered out because `tenant_id = NULL` is never
    // true). See migration 0004 for the full investigation.
    const result = await db.execute(
      sql`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '_outbox.messages'::regclass`,
    );
    const rows = result as unknown as Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relrowsecurity).toBe(false);
    expect(rows[0]?.relforcerowsecurity).toBe(false);
  });
});

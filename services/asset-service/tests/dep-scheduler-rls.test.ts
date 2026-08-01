/**
 * Regression test for the outbox_relay_cycle_failed / dep-scheduler-tick-failed
 * Postgres 42704 ("unrecognized configuration parameter app.tenant_id") bug —
 * see revenue-service/migrations/0004_outbox_inbox_durable.sql for the full
 * fleet-wide investigation this is part of.
 *
 * asset-service's depreciation scheduler (src/modules/depreciation/scheduler.ts)
 * crashed every 6h tick with this exact error until register.current_tenant_id()
 * was made NULL-safe (migration 0009_rls_full_tenant_isolation.sql):
 *   NULLIF(current_setting('app.tenant_id', true), '')::uuid
 * instead of the old current_setting('app.tenant_id', false) which RAISES
 * instead of returning NULL when no GUC is set — exactly the state a
 * tenant-agnostic cross-tenant scan (or the outbox relay) runs under.
 *
 * This is a REAL integration test against the live database (not a mock) —
 * the bug is specifically about Postgres GUC/RLS behaviour, which no fake
 * Drizzle handle can reproduce.
 *
 * Requires a live Postgres reachable at DATABASE_URL (see vitest.config.ts —
 * defaults to the dev civitas_asset DB), migrated through at least
 * 0009_rls_full_tenant_isolation.sql.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/shared/db.js";

describe("register.current_tenant_id() — 42704 regression (asset-service)", () => {
  it("is NULL-safe: returns NULL instead of raising 42704 when app.tenant_id is unset", async () => {
    // A fresh connection/session never had app.tenant_id set on it — exactly
    // the state the depreciation scheduler's cross-tenant scanner pool and
    // the outbox relay both run under.
    const result = await db.execute(sql`SELECT register.current_tenant_id() AS tenant_id`);
    const rows = result as unknown as Array<{ tenant_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBeNull();
  });

  it("a tenant-agnostic SELECT against _outbox.messages does not throw 42704 with no GUC set", async () => {
    // This is exactly the query relayOnce() (@civitasone/outbox) runs every
    // cycle. Before register.current_tenant_id() was made NULL-safe, this
    // line threw PostgresError 42704 for every single relay tick.
    await expect(
      db.execute(sql`SELECT count(*) FROM _outbox.messages WHERE published_at IS NULL`),
    ).resolves.toBeDefined();
  });
});

/**
 * GAP2-TENANT-BRANDING-RACE-06 — the branding consumer decided insert-vs-update
 * from a stale `isCreate` read taken in commands.ts before the command was
 * published. Two concurrent FIRST-EVER saves for the same tenant could both
 * carry isCreate:true; the second INSERT violated UNIQUE(tenant_id), threw, and
 * rolled back the whole consumer transaction (including markProcessed) — so the
 * second save could be silently dropped. repo.upsertByTenant now does a single
 * atomic `INSERT ... ON CONFLICT (tenant_id) DO UPDATE`.
 *
 * This test applies two "first save" projections (both the shape the old
 * isCreate:true path produced — distinct ids, version:1) for the SAME tenant.
 *   - OLD behaviour (two bare inserts) throws on the second (unique violation).
 *   - NEW behaviour: the second falls through to an UPDATE — both applied, one
 *     surviving row, version bumped, nothing dropped.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { tenantBranding, type TenantBrandingInsert } from "../src/modules/branding/schema.js";
import * as repo from "../src/modules/branding/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

function firstSaveProjection(appName: string): TenantBrandingInsert {
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId: TENANT,
    appName,
    primaryColor: "#1e40af",
    accentColor: "#f59e0b",
    poweredByHidden: false,
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
  };
}

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(tenantBranding).where(eq(tenantBranding.tenantId, TENANT))),
  );
  await sqlClient.end();
});

describe("GAP2-TENANT-BRANDING-RACE-06: atomic branding upsert", () => {
  it("two first-save projections for one tenant both apply (one insert, one update, nothing dropped)", async () => {
    const first = firstSaveProjection("Office First");
    const second = firstSaveProjection("Office Second"); // distinct id, version:1

    // First save -> insert.
    await runWithTenant(TENANT, () => db.transaction((tx) => repo.upsertByTenant(tx, first)));
    // Second "first save" -> must NOT throw; falls through to UPDATE.
    await expect(
      runWithTenant(TENANT, () => db.transaction((tx) => repo.upsertByTenant(tx, second))),
    ).resolves.toBeUndefined();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(tenantBranding).where(eq(tenantBranding.tenantId, TENANT))),
    );
    // Exactly one surviving row for the tenant (the singleton invariant holds).
    expect(rows).toHaveLength(1);
    // The second write's values won (last-writer-wins) and the version bumped
    // from the row that actually existed (not reset to the stale projected 1).
    expect(rows[0]!.appName).toBe("Office Second");
    expect(rows[0]!.version).toBe(2);
  });
});

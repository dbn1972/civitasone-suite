/**
 * GAP-NOTIFICATIONS-TEMPLATES-DETAIL-04 / DETAIL-02 — the template-versions
 * read model must carry createdAt + createdBy per version (so the detail page's
 * history table can show date + author), and the version chain must expose
 * explicit version numbers so the client can pick the current version by
 * MAX(version) regardless of row order.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";
import * as queries from "../src/modules/templates/queries.js";

const TENANT = "aaaa0004-1111-4000-8000-000000000004";
const ACTOR = "aaaa0004-2222-4000-8000-0000000000aa";
const V1 = "aaaa0004-3333-4000-8000-000000000001";
const V2 = "aaaa0004-3333-4000-8000-000000000002";

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(notificationTemplates).where(eq(notificationTemplates.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await cleanup();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    // Insert the current version (v2, supersededBy=null) first so v1's
    // supersededBy FK (templates_superseded_by_fkey) resolves.
    await tx.insert(notificationTemplates).values({
      id: V2, tenantId: TENANT, channel: "email", name: "Rent due", subject: "v2 subject",
      body: "new body", status: "active", version: 2, supersededBy: null,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    // v1 is superseded by v2. The status check constraint (migration 0020)
    // allows archived, not "superseded"; the UI treats a non-null supersededBy
    // as the superseded signal regardless of status.
    await tx.insert(notificationTemplates).values({
      id: V1, tenantId: TENANT, channel: "email", name: "Rent due", subject: "v1 subject",
      body: "old body", status: "archived", version: 1, supersededBy: V2,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("template version read model", () => {
  it("returns both versions with explicit version numbers (DETAIL-02)", async () => {
    const versions = await runWithTenant(TENANT, () => queries.listTemplateVersions(TENANT, V1));
    const nums = versions.map((v) => v.version).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2]);
    // The highest version is the current one; the client sorts by this.
    const current = [...versions].sort((a, b) => b.version - a.version)[0];
    expect(current?.id).toBe(V2);
    expect(current?.subject).toBe("v2 subject");
  });

  it("carries createdAt and createdBy per version (DETAIL-04)", async () => {
    const versions = await runWithTenant(TENANT, () => queries.listTemplateVersions(TENANT, V1));
    for (const v of versions) {
      expect(typeof v.createdAt).toBe("string");
      expect(v.createdBy).toBe(ACTOR);
    }
  });
});

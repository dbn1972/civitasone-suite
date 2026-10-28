/**
 * UAT DB test g7-municipal defect 5: shop completeScrutiny wrote status/findings but left
 * the optimistic-lock `version` at 1. Real-DB regression (needs DATABASE_URL).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { scrutinyRecords } from "../src/modules/approvals/schema.js";
import * as repo from "../src/modules/approvals/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const id = randomUUID();

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(scrutinyRecords).where(eq(scrutinyRecords.tenantId, TENANT))));
  await sqlClient.end();
});

describe("shop completeScrutiny", () => {
  it("bumps version when completed", async () => {
    const row = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await repo.insertScrutiny(tx, { id, tenantId: TENANT, applicationId: randomUUID(), scrutinyType: "document", officerId: ACTOR, status: "pending", createdBy: ACTOR, updatedBy: ACTOR });
      const ok = await repo.completeScrutiny(tx, id, TENANT, ["pending"], "completed", { ok: true }, null, ACTOR);
      expect(ok).toBe(true);
      const [r] = await tx.select().from(scrutinyRecords).where(eq(scrutinyRecords.id, id));
      return r!;
    }));
    expect(row.status).toBe("completed");
    expect(row.version).toBe(2);
  });
});

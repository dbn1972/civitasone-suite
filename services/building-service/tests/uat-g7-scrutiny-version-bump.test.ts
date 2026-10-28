/**
 * UAT DB test g7-municipal defect 5: building completeScrutiny wrote status/findings but left
 * the optimistic-lock `version` at 1. Real-DB regression (needs DATABASE_URL).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildingScrutiny } from "../src/modules/scrutiny/schema.js";
import * as repo from "../src/modules/scrutiny/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const id = randomUUID();

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(buildingScrutiny).where(eq(buildingScrutiny.tenantId, TENANT))));
  await sqlClient.end();
});

describe("building completeScrutiny", () => {
  it("bumps version when completed", async () => {
    const row = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await repo.insertScrutiny(tx, { id, tenantId: TENANT, applicationId: randomUUID(), discipline: "structural", officerId: ACTOR, status: "pending", createdBy: ACTOR, updatedBy: ACTOR });
      const ok = await repo.completeScrutiny(tx, id, TENANT, "completed", { ok: true }, null, null, ACTOR);
      expect(ok).toBe(true);
      const [r] = await tx.select().from(buildingScrutiny).where(eq(buildingScrutiny.id, id));
      return r!;
    }));
    expect(row.status).toBe("completed");
    expect(row.version).toBe(2);
  });
});

/**
 * UAT DB test g7-municipal defect 5: roadcut completeInspection wrote status/findings but left
 * the optimistic-lock `version` at 1. Real-DB regression (needs DATABASE_URL).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { roadcutInspections } from "../src/modules/inspections/schema.js";
import * as repo from "../src/modules/inspections/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const id = randomUUID();

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(roadcutInspections).where(eq(roadcutInspections.tenantId, TENANT))));
  await sqlClient.end();
});

describe("roadcut completeInspection", () => {
  it("bumps version when completed", async () => {
    const row = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await repo.insertInspection(tx, { id, tenantId: TENANT, permitId: randomUUID(), inspectionType: "interim", inspectorId: ACTOR, scheduledDate: "2026-11-01", status: "scheduled", createdBy: ACTOR, updatedBy: ACTOR });
      const ok = await repo.completeInspection(tx, id, TENANT, "completed", { ok: true }, null, null, ACTOR);
      expect(ok).toBe(true);
      const [r] = await tx.select().from(roadcutInspections).where(eq(roadcutInspections.id, id));
      return r!;
    }));
    expect(row.status).toBe("completed");
    expect(row.version).toBe(2);
  });
});

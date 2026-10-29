/**
 * UAT g3 #14 (payroll): updateRun must bump `version` so optimistic-concurrency readers see run changes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns } from "../src/modules/payroll/schema.js";
import { updateRun } from "../src/modules/payroll/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const scoped = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

afterAll(async () => {
  await scoped((tx) => tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT)));
  await sqlClient.end();
});

describe("#14 payroll updateRun bumps version", () => {
  it("version goes 1 -> 2 -> 3 across two updates and the patch is applied", async () => {
    const id = randomUUID();
    await scoped((tx) => tx.insert(payrollRuns).values({
      id, tenantId: TENANT, runNo: `UATTEST-${id.slice(0, 6)}`, month: "2026-10", structureId: randomUUID(),
      status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await scoped((tx) => updateRun(tx, id, { status: "processing" }));
    await scoped((tx) => updateRun(tx, id, { status: "approved" }));
    const row = (await scoped((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, id))))[0]!;
    expect(row.status).toBe("approved");
    expect(row.version).toBe(3);
  });
});

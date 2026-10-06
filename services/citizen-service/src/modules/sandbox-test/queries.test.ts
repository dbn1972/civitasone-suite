/**
 * GAP-DESIGNER-HOME-04: DB-backed test for the batch-lookup of latest sandbox
 * test outcomes per service-definition ID.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { sandboxTestRuns } from "./schema.js";
import { latestTestStatusByDefinitionIds } from "./queries.js";

const tenantId = randomUUID();
const defA = randomUUID();
const defB = randomUUID();
const defC = randomUUID(); // no runs — should be absent from result
const actor = randomUUID();

/** Run inside tenant context so RLS allows the operation. */
function asTenant<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

beforeAll(async () => {
  // Insert test runs: defA has two (fail then pass → latest = pass),
  // defB has one (fail → latest = fail).
  await asTenant(async (tx) => {
    await tx.insert(sandboxTestRuns).values([
      {
        id: randomUUID(),
        tenantId,
        serviceDefinitionId: defA,
        status: "fail",
        steps: [],
        durationMs: 10,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        createdBy: actor,
      },
      {
        id: randomUUID(),
        tenantId,
        serviceDefinitionId: defA,
        status: "pass",
        steps: [],
        durationMs: 12,
        createdAt: new Date("2026-01-02T00:00:00Z"),
        createdBy: actor,
      },
      {
        id: randomUUID(),
        tenantId,
        serviceDefinitionId: defB,
        status: "fail",
        steps: [],
        durationMs: 8,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        createdBy: actor,
      },
    ]);
  });
});

afterAll(async () => {
  // Clean up test rows by the unique tenantId.
  await asTenant(async (tx) => {
    await tx.delete(sandboxTestRuns).where(eq(sandboxTestRuns.tenantId, tenantId));
  });
});

describe("latestTestStatusByDefinitionIds (GAP-DESIGNER-HOME-04)", () => {
  it("returns the most recent test status per definition", async () => {
    // queries.ts runs inside runWithTenant in production (via the route handler
    // + wrapWithTenantGuc). Our test must do the same to satisfy RLS.
    const result = await runWithTenant(tenantId, () =>
      latestTestStatusByDefinitionIds(tenantId, [defA, defB, defC]),
    );
    expect(result.get(defA)).toBe("pass"); // newer run wins
    expect(result.get(defB)).toBe("fail");
    expect(result.has(defC)).toBe(false);   // no runs → absent
  });

  it("returns empty map for empty input", async () => {
    const result = await latestTestStatusByDefinitionIds(tenantId, []);
    expect(result.size).toBe(0);
  });

  it("ignores runs for a different tenant", async () => {
    const otherTenant = randomUUID();
    const result = await runWithTenant(otherTenant, () =>
      latestTestStatusByDefinitionIds(otherTenant, [defA, defB]),
    );
    expect(result.size).toBe(0);
  });
});

/**
 * A sandbox pass is bound to the design it tested. Before this, submit only
 * checked that the LATEST run's status was "pass": pass the test, edit the
 * fee/form/workflow, and submit still went through.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../src/shared/db.js";
import * as catalogueRepo from "../src/modules/catalogue/repo.js";
import * as sandboxRepo from "../src/modules/sandbox-test/repo.js";
import { assertLatestTestPassed, runSandboxTest } from "../src/modules/sandbox-test/commands.js";
import { definitionDesignHash } from "../src/modules/sandbox-test/design-hash.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const DEF_ID = randomUUID();
const ctx = { tenantId: TENANT, actorId: ACTOR, roles: ["citizen_officer"], correlationId: randomUUID() } as unknown as RequestContext;

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return (e as { code?: string }).code ?? "ERR"; }
}

describe("sandbox pass is bound to the tested design", () => {
  beforeAll(async () => {
    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await catalogueRepo.insertDefinition(tx, {
          id: DEF_ID, tenantId: TENANT, serviceKey: `bind-${Date.now().toString(36)}`, name: "Binding",
          servicePattern: "certificate", ownerDepartment: "Licensing", version: 1, status: "draft",
          channels: ["portal"], requiredDocuments: [], forms: [], outputs: [], statutoryReferences: [],
          slaDays: 7, createdBy: ACTOR, updatedBy: ACTOR,
        });
      });
    });
  });
  afterAll(async () => { await sqlClient.end(); });

  const current = () => runWithTenant(TENANT, () => catalogueRepo.findDefinitionById(DEF_ID, TENANT));
  const record = (status: "pass" | "fail", definitionHash: string | null) =>
    runWithTenant(TENANT, () => db.transaction((tx) => sandboxRepo.insertRun(tx, {
      tenantId: TENANT, serviceDefinitionId: DEF_ID, status, steps: [], durationMs: 1, definitionHash, createdBy: ACTOR,
    })));

  it("a run records the hash of the design it tested", async () => {
    const run = await runWithTenant(TENANT, () => runSandboxTest(ctx, DEF_ID));
    const def = (await current())!;
    const latest = await runWithTenant(TENANT, () => sandboxRepo.latestRunForDefinition(TENANT, DEF_ID));
    expect(latest?.id).toBe(run.id);
    expect(latest?.definitionHash).toBe(definitionDesignHash(def));
  });

  it("a passing run for the CURRENT design authorises submit", async () => {
    const def = (await current())!;
    await record("pass", definitionDesignHash(def));
    expect(await codeOf(runWithTenant(TENANT, () => assertLatestTestPassed(ctx, DEF_ID)))).toBeNull();
  });

  it("a pass recorded before the design changed is rejected as TEST_STALE", async () => {
    const before = (await current())!;
    await record("pass", definitionDesignHash(before));
    await runWithTenant(TENANT, () => db.transaction((tx) =>
      catalogueRepo.updateDefinition(tx, DEF_ID, TENANT, { slaDays: 30, updatedBy: ACTOR } as never)));
    expect(await codeOf(runWithTenant(TENANT, () => assertLatestTestPassed(ctx, DEF_ID)))).toBe("TEST_STALE");
  });

  it("a pre-migration pass (NULL hash) is stale", async () => {
    await record("pass", null);
    expect(await codeOf(runWithTenant(TENANT, () => assertLatestTestPassed(ctx, DEF_ID)))).toBe("TEST_STALE");
  });

  it("a failing latest run is still TEST_NOT_PASSED", async () => {
    const def = (await current())!;
    await record("fail", definitionDesignHash(def));
    expect(await codeOf(runWithTenant(TENANT, () => assertLatestTestPassed(ctx, DEF_ID)))).toBe("TEST_NOT_PASSED");
  });

  it("re-running the test on the changed design re-authorises submit", async () => {
    const def = (await current())!;
    await record("pass", definitionDesignHash(def));
    expect(await codeOf(runWithTenant(TENANT, () => assertLatestTestPassed(ctx, DEF_ID)))).toBeNull();
  });
});

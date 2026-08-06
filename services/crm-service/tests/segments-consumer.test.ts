/**
 * G5 — segment taxonomy consumers, driven directly.
 *
 * Covers what the HTTP path deliberately hides: a redelivered messageId, a command
 * forged onto the bus against a canonical row (the route's 422 is not the only guard),
 * a stale-version write, and Redis being unavailable on the enforcement read path.
 *
 * Direct invocation is wrapped in `runWithTenant` because the real queue decorates
 * `subscribe` with a tenant context; without it every FORCE-RLS write is rejected.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { cache } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { captureHandlers, envelope } from "./consumer-harness.js";
import * as repo from "../src/modules/segments/repo.js";
import { assertSegmentAllowed, publishedCodes } from "../src/modules/segments/queries.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

const { handlerFor } = captureHandlers();

async function run(topic: string, payload: Record<string, unknown>, messageId = randomUUID()): Promise<void> {
  const handler = handlerFor(topic);
  await runWithTenant(TENANT, () => handler(envelope(topic, payload, { tenantId: TENANT, actorId: ACTOR, messageId })));
}

async function seed(segmentCode: string, governance: "tenant" | "canonical" = "tenant"): Promise<void> {
  await run(COMMANDS.createSegmentDefinition, {
    tenantId: TENANT,
    segmentCode,
    displayName: `${segmentCode} display`,
    description: null,
    governance,
    priorityProducts: ["P1"],
    primaryChannels: ["email"],
  });
}

async function row(segmentCode: string) {
  const rows = (await scoped(
    (tx) => tx`
      SELECT display_name AS "displayName", status, governance, version, version_number AS "versionNumber",
             deleted_at AS "deletedAt"
      FROM crm.segment_definitions WHERE tenant_id = ${TENANT} AND segment_code = ${segmentCode}
    `,
  )) as unknown as Array<{
    displayName: string;
    status: string;
    governance: string;
    version: number;
    versionNumber: number;
    deletedAt: Date | null;
  }>;
  return rows[0];
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.segment_definitions WHERE tenant_id = ${TENANT}`);
  await scoped((tx) => tx`DELETE FROM crm.segment_settings WHERE tenant_id = ${TENANT}`);
  await cache.invalidateResource(TENANT, repo.RESOURCE);
  await cache.invalidateResource(TENANT, repo.SETTINGS_RESOURCE);
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("idempotency", () => {
  it("a redelivered create writes one row, not two", async () => {
    const messageId = randomUUID();
    const payload = {
      tenantId: TENANT,
      segmentCode: "IDEMPOTENT",
      displayName: "Idempotent",
      description: null,
      governance: "tenant",
      priorityProducts: ["P1"],
      primaryChannels: ["email"],
    };
    await run(COMMANDS.createSegmentDefinition, payload, messageId);
    await run(COMMANDS.createSegmentDefinition, payload, messageId);

    const rows = (await scoped(
      (tx) => tx`SELECT count(*)::int AS n FROM crm.segment_definitions WHERE tenant_id = ${TENANT} AND segment_code = 'IDEMPOTENT'`,
    )) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it("a create replayed under a NEW messageId still converges on one row", async () => {
    // Second layer of defence: ON CONFLICT (tenant_id, segment_code) DO NOTHING, so a
    // lost inbox row cannot produce two definitions that disagree about priority.
    await seed("CONVERGE");
    await seed("CONVERGE");
    const rows = (await scoped(
      (tx) => tx`SELECT count(*)::int AS n FROM crm.segment_definitions WHERE tenant_id = ${TENANT} AND segment_code = 'CONVERGE'`,
    )) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  it("a redelivered publish does not bump the taxonomy revision twice", async () => {
    await seed("PUB_ONCE");
    const messageId = randomUUID();
    await run(COMMANDS.publishSegmentDefinition, { tenantId: TENANT, segmentCode: "PUB_ONCE" }, messageId);
    const first = await row("PUB_ONCE");
    await run(COMMANDS.publishSegmentDefinition, { tenantId: TENANT, segmentCode: "PUB_ONCE" }, messageId);
    const second = await row("PUB_ONCE");
    expect(second?.versionNumber).toBe(first?.versionNumber);
  });
});

describe("guarded writes — the route's refusals are not the only defence", () => {
  it("an update command forged onto the bus cannot edit a canonical row", async () => {
    await seed("BUS_CANONICAL", "canonical");
    const before = await row("BUS_CANONICAL");
    await run(COMMANDS.updateSegmentDefinition, {
      tenantId: TENANT,
      segmentCode: "BUS_CANONICAL",
      displayName: "Forged",
      version: before!.version,
    });
    expect((await row("BUS_CANONICAL"))?.displayName).toBe("BUS_CANONICAL display");
  });

  it("a delete command forged onto the bus cannot soft-delete a canonical row", async () => {
    await seed("BUS_CANONICAL_DEL", "canonical");
    await run(COMMANDS.deleteSegmentDefinition, { tenantId: TENANT, segmentCode: "BUS_CANONICAL_DEL" });
    expect((await row("BUS_CANONICAL_DEL"))?.deletedAt).toBeNull();
  });

  it("a stale-version update is a no-op, not a clobber", async () => {
    await seed("BUS_STALE");
    const before = await row("BUS_STALE");
    await run(COMMANDS.updateSegmentDefinition, {
      tenantId: TENANT,
      segmentCode: "BUS_STALE",
      displayName: "Stale",
      version: before!.version + 7,
    });
    expect((await row("BUS_STALE"))?.displayName).toBe("BUS_STALE display");
  });

  it("deprecating a draft is refused by the guarded UPDATE", async () => {
    await seed("BUS_DRAFT");
    await run(COMMANDS.deprecateSegmentDefinition, { tenantId: TENANT, segmentCode: "BUS_DRAFT" });
    expect((await row("BUS_DRAFT"))?.status).toBe("draft");
  });

  it("a command for a segment that does not exist is a no-op rather than an error", async () => {
    await expect(
      run(COMMANDS.publishSegmentDefinition, { tenantId: TENANT, segmentCode: "GHOST" }),
    ).resolves.toBeUndefined();
  });

  it("applies a description-only update, including clearing it to null", async () => {
    await seed("BUS_DESC");
    let current = await row("BUS_DESC");
    await run(COMMANDS.updateSegmentDefinition, {
      tenantId: TENANT,
      segmentCode: "BUS_DESC",
      description: "Now described",
      version: current!.version,
    });
    let stored = (await scoped(
      (tx) => tx`SELECT description FROM crm.segment_definitions WHERE tenant_id = ${TENANT} AND segment_code = 'BUS_DESC'`,
    )) as unknown as Array<{ description: string | null }>;
    expect(stored[0]?.description).toBe("Now described");

    current = await row("BUS_DESC");
    await run(COMMANDS.updateSegmentDefinition, {
      tenantId: TENANT,
      segmentCode: "BUS_DESC",
      description: null,
      version: current!.version,
    });
    stored = (await scoped(
      (tx) => tx`SELECT description FROM crm.segment_definitions WHERE tenant_id = ${TENANT} AND segment_code = 'BUS_DESC'`,
    )) as unknown as Array<{ description: string | null }>;
    expect(stored[0]?.description).toBeNull();
  });

  it("rethrows (so the message can be retried / dead-lettered) when the write is impossible", async () => {
    await expect(
      run(COMMANDS.createSegmentDefinition, {
        tenantId: TENANT,
        segmentCode: "BROKEN",
        // displayName omitted → NOT NULL violation. The handler must not swallow it.
        description: null,
        governance: "tenant",
        priorityProducts: [],
        primaryChannels: [],
      }),
    ).rejects.toThrow();
  });
});

describe("settings consumer", () => {
  it("upserts the switch and converges on replay", async () => {
    await run(COMMANDS.setSegmentSettings, { tenantId: TENANT, enforceSegmentCatalogue: true });
    await run(COMMANDS.setSegmentSettings, { tenantId: TENANT, enforceSegmentCatalogue: false });
    const rows = (await scoped(
      (tx) => tx`SELECT enforce_segment_catalogue AS "on", version FROM crm.segment_settings WHERE tenant_id = ${TENANT}`,
    )) as unknown as Array<{ on: boolean; version: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.on).toBe(false);
    expect(rows[0]?.version).toBe(2);
  });
});

describe("graceful degradation and the enforcement read path", () => {
  it("falls through to Postgres when the cache is unavailable rather than failing a classification", async () => {
    await run(COMMANDS.setSegmentSettings, { tenantId: TENANT, enforceSegmentCatalogue: true });
    const broken = vi.spyOn(cache, "getOrLoad").mockRejectedValue(new Error("redis unavailable"));
    try {
      // runWithTenant because the Postgres fallthrough reads under RLS — without a
      // tenant context FORCE ROW LEVEL SECURITY would return zero rows and the switch
      // would silently read as "off".
      const settings = await runWithTenant(TENANT, () => repo.getSettings(TENANT));
      expect(settings.enforceSegmentCatalogue).toBe(true);
    } finally {
      broken.mockRestore();
    }
    await run(COMMANDS.setSegmentSettings, { tenantId: TENANT, enforceSegmentCatalogue: false });
  });

  it("re-throws a database failure instead of pretending enforcement is off", async () => {
    const broken = vi.spyOn(repo, "getSettings");
    broken.mockRejectedValue(new Error("database unavailable"));
    try {
      await expect(assertSegmentAllowed(TENANT, "ANY")).rejects.toThrow("database unavailable");
    } finally {
      broken.mockRestore();
    }
  });

  it("lists only published, non-deleted codes", async () => {
    await cleanup();
    await seed("CODE_DRAFT");
    await seed("CODE_PUBLISHED");
    await seed("CODE_RETIRED");
    await run(COMMANDS.publishSegmentDefinition, { tenantId: TENANT, segmentCode: "CODE_PUBLISHED" });
    await run(COMMANDS.publishSegmentDefinition, { tenantId: TENANT, segmentCode: "CODE_RETIRED" });
    await run(COMMANDS.deleteSegmentDefinition, { tenantId: TENANT, segmentCode: "CODE_RETIRED" });
    await cache.invalidateResource(TENANT, repo.RESOURCE);
    expect(await runWithTenant(TENANT, () => publishedCodes(TENANT))).toEqual(["CODE_PUBLISHED"]);
  });
});

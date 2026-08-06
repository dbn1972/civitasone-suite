/**
 * G1 + G2 (spec §25) — journeys command consumers.
 *
 * Handlers are invoked directly (via `captureHandlers`) rather than through the bus,
 * because the three properties under test are exactly the ones the bus hides:
 *
 *  1. IDEMPOTENCY — `markProcessed` is the first statement in the transaction, so a
 *     redelivered messageId is a no-op. Were it not, a redelivered create would raise a
 *     primary-key violation and a redelivered update would bump the version twice.
 *  2. TENANT ISOLATION — every guarded write carries its own tenant predicate, so a
 *     command that names another tenant's row changes nothing and is audited as such.
 *  3. THE OUTBOX — the domain event and its audit event are enqueued in the SAME
 *     transaction as the write, and a command that changed nothing enqueues an audit row
 *     WITHOUT a domain event (telling downstream that something changed when it did not is
 *     how a stale projection is born).
 *
 * Rows are seeded with SQL: the HTTP path is covered in journeys.test.ts, and these cases
 * need a starting state the route would refuse to create (a published row to republish, a
 * canonical row to forge a command against).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { captureHandlers, envelope } from "./consumer-harness.js";
import { PLATFORM_TENANT_ID, type JourneyStep } from "../src/modules/journeys/schema.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

function step(stageCode: string, ordinal: number, extra: Partial<JourneyStep> = {}): JourneyStep {
  return { id: randomUUID(), stageCode, ordinal, ...extra };
}

const STEPS: JourneyStep[] = [
  step("lead_captured", 10, { slaHours: 24 }),
  step("qualified", 20),
  step("agreed", 40),
];

interface StageRow {
  id: string;
  stageCode: string;
  displayName: string;
  ordinal: number;
  required: boolean;
  governance: string;
  version: number;
  deletedAt: string | null;
}

interface TemplateRow {
  id: string;
  templateKey: string;
  name: string;
  status: string;
  versionNumber: number;
  version: number;
  steps: JourneyStep[];
  publishedAt: string | null;
  deprecatedAt: string | null;
  deletedAt: string | null;
}

async function stageRow(tenantId: string, id: string): Promise<StageRow | undefined> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT id, stage_code AS "stageCode", display_name AS "displayName", ordinal, required,
           governance, version, deleted_at AS "deletedAt"
    FROM crm.stage_vocabulary WHERE id = ${id}
  `)) as unknown as StageRow[];
  return rows[0];
}

async function templateRow(tenantId: string, id: string): Promise<TemplateRow | undefined> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT id, template_key AS "templateKey", name, status,
           version_number AS "versionNumber", version, steps,
           published_at AS "publishedAt", deprecated_at AS "deprecatedAt",
           deleted_at AS "deletedAt"
    FROM crm.journey_templates WHERE id = ${id}
  `)) as unknown as TemplateRow[];
  return rows[0];
}

/** Domain event payloads of one type, oldest first. */
async function eventPayloads(
  tenantId: string,
  eventType: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND event_type = ${eventType}
    ORDER BY created_at
  `)) as unknown as Array<{ payload: Record<string, unknown> }>;
  return rows.map((r) => r.payload);
}

/** Audit outcomes recorded against one resource, oldest first. */
async function auditOutcomes(tenantId: string, resourceId: string): Promise<string[]> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND event_type = 'audit.event.record'
      AND payload->>'resourceId' = ${resourceId}
    ORDER BY created_at
  `)) as unknown as Array<{ payload: { outcome: string } }>;
  return rows.map((r) => r.payload.outcome);
}

async function seedStage(
  tenantId: string,
  overrides: Partial<{ stageCode: string; displayName: string; version: number; deleted: boolean }> = {},
): Promise<string> {
  const id = randomUUID();
  const stageCode = overrides.stageCode ?? `seeded_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
  // ISO strings with an explicit cast: postgres.js will not bind a Date into a parameter
  // whose type the server describes as unknown.
  const deletedAt = overrides.deleted === true ? new Date().toISOString() : null;
  await scoped(tenantId, (tx) => tx`
    INSERT INTO crm.stage_vocabulary
      (id, tenant_id, stage_code, display_name, ordinal, required, governance,
       version, deleted_at, created_by, updated_by)
    VALUES (${id}, ${tenantId}, ${stageCode}, ${overrides.displayName ?? "Seeded Stage"},
            15, false, 'tenant', ${overrides.version ?? 1},
            ${deletedAt}::timestamptz, ${ACTOR_A}, ${ACTOR_A})
  `);
  return id;
}

async function seedTemplate(
  tenantId: string,
  overrides: Partial<{ status: string; versionNumber: number; version: number; templateKey: string; deleted: boolean }> = {},
): Promise<string> {
  const id = randomUUID();
  const templateKey = overrides.templateKey ?? `seeded_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
  const status = overrides.status ?? "draft";
  const now = new Date().toISOString();
  const publishedAt = status === "draft" ? null : now;
  const deletedAt = overrides.deleted === true ? now : null;
  await scoped(tenantId, (tx) => tx`
    INSERT INTO crm.journey_templates
      (id, tenant_id, template_key, name, governance, parent_template_id, steps,
       version_number, status, published_at, version, deleted_at, created_by, updated_by)
    VALUES (${id}, ${tenantId}, ${templateKey}, 'Seeded Template', 'tenant', NULL,
            ${JSON.stringify(STEPS)}::jsonb, ${overrides.versionNumber ?? 1}, ${status},
            ${publishedAt}::timestamptz, ${overrides.version ?? 1},
            ${deletedAt}::timestamptz, ${ACTOR_A}, ${ACTOR_A})
  `);
  return id;
}

/** Only ever this run's two tenants; the platform sentinel's rows are never written. */
async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await scoped(tenantId, async (tx) => {
      await tx`DELETE FROM crm.journey_templates WHERE tenant_id = ${tenantId}`;
      await tx`DELETE FROM crm.stage_vocabulary WHERE tenant_id = ${tenantId}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenantId}`;
    }).catch(() => {});
  }
}

const handlers = captureHandlers();

/** Deliver a command exactly as the bus would, in the tenant context the queue sets up. */
function deliver(
  topic: string,
  payload: unknown,
  opts: { tenantId: string; actorId: string; messageId?: string },
): Promise<void> {
  const msg = envelope(topic, payload, opts);
  return runWithTenant(opts.tenantId, () => handlers.handlerFor(topic)(msg));
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

// ── Stage vocabulary consumers ─────────────────────────────────────────────────

describe("crm.stage_vocabulary.create consumer", () => {
  it("inserts the row and enqueues the domain event plus its audit event", async () => {
    const id = randomUUID();
    const stageCode = `created_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    await deliver(COMMANDS.createStageCode, {
      id,
      tenantId: TENANT_A,
      stageCode,
      displayName: "Created By Consumer",
      description: null,
      ordinal: 33,
      required: true,
      governance: "tenant",
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await stageRow(TENANT_A, id);
    expect(row?.stageCode).toBe(stageCode);
    expect(row?.ordinal).toBe(33);
    expect(row?.required).toBe(true);
    expect(row?.governance).toBe("tenant");

    const created = (await eventPayloads(TENANT_A, EVENTS.stageCodeCreated))
      .filter((p) => p.stageId === id);
    expect(created, "the outbox must carry the created event").toHaveLength(1);
    expect(created[0]).toMatchObject({ stageCode, ordinal: 33, required: true, governance: "tenant" });
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["success"]);
  });

  it("is a no-op on redelivery — one row and one event, not a primary-key failure", async () => {
    const id = randomUUID();
    const stageCode = `redelivered_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const messageId = randomUUID();
    const payload = {
      id,
      tenantId: TENANT_A,
      stageCode,
      displayName: "Redelivered",
      description: null,
      ordinal: 5,
      required: false,
      governance: "tenant" as const,
    };

    await deliver(COMMANDS.createStageCode, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.createStageCode, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    const rows = (await scoped(TENANT_A, (tx) => tx`
      SELECT id FROM crm.stage_vocabulary
      WHERE tenant_id = ${TENANT_A} AND stage_code = ${stageCode}
    `)) as unknown as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect((await eventPayloads(TENANT_A, EVENTS.stageCodeCreated)).filter((p) => p.stageId === id))
      .toHaveLength(1);
  });
});

describe("crm.stage_vocabulary.create consumer — failure is surfaced, not swallowed", () => {
  /**
   * A DIFFERENT messageId carrying a code the tenant already has cannot be deduped away, so
   * the handler must let the error out: a swallowed unique violation would report success
   * for a command that wrote nothing and the caller would never learn.
   */
  it("rethrows a unique-constraint violation so the message can be retried or dead-lettered", async () => {
    const stageCode = `clashing_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    await seedStage(TENANT_A, { stageCode });

    await expect(deliver(COMMANDS.createStageCode, {
      id: randomUUID(),
      tenantId: TENANT_A,
      stageCode,
      displayName: "Clashing Code",
      description: null,
      ordinal: 1,
      required: false,
      governance: "tenant",
    }, { tenantId: TENANT_A, actorId: ACTOR_A })).rejects.toThrow();
  });
});

describe("crm.stage_vocabulary.update consumer", () => {
  it("applies the patch, bumps the version and reports which fields changed", async () => {
    const id = await seedStage(TENANT_A, { displayName: "Before" });
    await deliver(COMMANDS.updateStageCode, {
      id, tenantId: TENANT_A, displayName: "After", ordinal: 44, version: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await stageRow(TENANT_A, id);
    expect(row?.displayName).toBe("After");
    expect(row?.ordinal).toBe(44);
    expect(row?.version).toBe(2);

    const updated = (await eventPayloads(TENANT_A, EVENTS.stageCodeUpdated)).filter((p) => p.stageId === id);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.changed).toEqual(["displayName", "ordinal"]);
  });

  it("applies a redelivered update exactly once", async () => {
    const id = await seedStage(TENANT_A, { displayName: "Once" });
    const messageId = randomUUID();
    const payload = { id, tenantId: TENANT_A, displayName: "Applied Once", version: 1 };

    await deliver(COMMANDS.updateStageCode, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.updateStageCode, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    const row = await stageRow(TENANT_A, id);
    expect(row?.displayName).toBe("Applied Once");
    expect(row?.version, "a second apply would make this 3").toBe(2);
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["success"]);
  });

  it("audits a stale version without emitting a domain event", async () => {
    const id = await seedStage(TENANT_A, { displayName: "Unchanged" });
    await deliver(COMMANDS.updateStageCode, {
      id, tenantId: TENANT_A, displayName: "Never Applied", version: 99,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await stageRow(TENANT_A, id);
    expect(row?.displayName).toBe("Unchanged");
    expect(row?.version).toBe(1);
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["version_conflict"]);
    expect((await eventPayloads(TENANT_A, EVENTS.stageCodeUpdated)).filter((p) => p.stageId === id))
      .toHaveLength(0);
  });

  it("passes description and required through, including an explicit null", async () => {
    const id = await seedStage(TENANT_A);
    await deliver(COMMANDS.updateStageCode, {
      id, tenantId: TENANT_A, description: null, required: true, version: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const rows = (await scoped(TENANT_A, (tx) => tx`
      SELECT description, required FROM crm.stage_vocabulary WHERE id = ${id}
    `)) as unknown as Array<{ description: string | null; required: boolean }>;
    expect(rows[0]?.description).toBeNull();
    expect(rows[0]?.required).toBe(true);
  });

  it("a command from tenant B cannot amend tenant A's row", async () => {
    const id = await seedStage(TENANT_A, { displayName: "Tenant A Wording" });
    await deliver(COMMANDS.updateStageCode, {
      id, tenantId: TENANT_B, displayName: "Hijacked", version: 1,
    }, { tenantId: TENANT_B, actorId: ACTOR_B });

    const row = await stageRow(TENANT_A, id);
    expect(row?.displayName).toBe("Tenant A Wording");
    expect(row?.version).toBe(1);
    expect(await auditOutcomes(TENANT_B, id)).toEqual(["version_conflict"]);
  });

  /**
   * The canonical row is not reachable even by a forged command: the repo's
   * `governance = 'tenant'` predicate matches nothing, so the write is audited and dropped
   * rather than reaching the 0081 trigger and dead-lettering forever.
   */
  it("a forged command cannot rename a canonical row, and does not dead-letter trying", async () => {
    const rows = (await scoped(TENANT_A, (tx) => tx`
      SELECT id, display_name AS "displayName", version FROM crm.stage_vocabulary
      WHERE tenant_id = ${PLATFORM_TENANT_ID} AND stage_code = 'lead_captured'
    `)) as unknown as Array<{ id: string; displayName: string; version: number }>;
    const canonical = rows[0]!;

    await deliver(COMMANDS.updateStageCode, {
      id: canonical.id, tenantId: PLATFORM_TENANT_ID, displayName: "Renamed Nationally", version: canonical.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const after = (await scoped(TENANT_A, (tx) => tx`
      SELECT display_name AS "displayName", version FROM crm.stage_vocabulary WHERE id = ${canonical.id}
    `)) as unknown as Array<{ displayName: string; version: number }>;
    expect(after[0]?.displayName).toBe(canonical.displayName);
    expect(after[0]?.version).toBe(canonical.version);
  });
});

describe("crm.stage_vocabulary.delete consumer", () => {
  it("soft-deletes the row and emits the deleted event", async () => {
    const id = await seedStage(TENANT_A);
    await deliver(COMMANDS.deleteStageCode, { id, tenantId: TENANT_A }, {
      tenantId: TENANT_A, actorId: ACTOR_A,
    });

    const row = await stageRow(TENANT_A, id);
    expect(row?.deletedAt).not.toBeNull();
    expect((await eventPayloads(TENANT_A, EVENTS.stageCodeDeleted)).filter((p) => p.stageId === id))
      .toHaveLength(1);
  });

  it("audits a delete of a row that has already gone, without an event", async () => {
    const id = await seedStage(TENANT_A, { deleted: true });
    await deliver(COMMANDS.deleteStageCode, { id, tenantId: TENANT_A }, {
      tenantId: TENANT_A, actorId: ACTOR_A,
    });

    expect(await auditOutcomes(TENANT_A, id)).toEqual(["not_applicable"]);
    expect((await eventPayloads(TENANT_A, EVENTS.stageCodeDeleted)).filter((p) => p.stageId === id))
      .toHaveLength(0);
  });

  it("is a no-op on redelivery", async () => {
    const id = await seedStage(TENANT_A);
    const messageId = randomUUID();
    const payload = { id, tenantId: TENANT_A };
    await deliver(COMMANDS.deleteStageCode, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.deleteStageCode, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["success"]);
  });

  it("a command from tenant B cannot delete tenant A's row", async () => {
    const id = await seedStage(TENANT_A);
    await deliver(COMMANDS.deleteStageCode, { id, tenantId: TENANT_B }, {
      tenantId: TENANT_B, actorId: ACTOR_B,
    });
    expect((await stageRow(TENANT_A, id))?.deletedAt).toBeNull();
    expect(await auditOutcomes(TENANT_B, id)).toEqual(["not_applicable"]);
  });
});

// ── Journey template consumers ─────────────────────────────────────────────────

describe("crm.journey_template.create consumer", () => {
  it("inserts a draft and emits the created event with no step detail", async () => {
    const id = randomUUID();
    const templateKey = `created_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    await deliver(COMMANDS.createJourneyTemplate, {
      id,
      tenantId: TENANT_A,
      templateKey,
      name: "Created By Consumer",
      description: null,
      parentTemplateId: null,
      product: "current_account",
      region: null,
      businessUnit: null,
      steps: STEPS,
      versionNumber: 1,
      governance: "tenant",
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await templateRow(TENANT_A, id);
    expect(row?.status).toBe("draft");
    expect(row?.versionNumber).toBe(1);
    expect(row?.steps.map((s) => s.stageCode)).toEqual(["lead_captured", "qualified", "agreed"]);

    const created = (await eventPayloads(TENANT_A, EVENTS.journeyTemplateCreated))
      .filter((p) => p.templateId === id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ templateKey, versionNumber: 1, stepCount: 3 });
    expect(created[0], "step detail is configuration, not event payload").not.toHaveProperty("steps");
  });

  it("is a no-op on redelivery", async () => {
    const id = randomUUID();
    const templateKey = `redelivered_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const messageId = randomUUID();
    const payload = {
      id,
      tenantId: TENANT_A,
      templateKey,
      name: "Redelivered Template",
      description: null,
      parentTemplateId: null,
      product: null,
      region: null,
      businessUnit: null,
      steps: STEPS,
      versionNumber: 1,
      governance: "tenant" as const,
    };

    await deliver(COMMANDS.createJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.createJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    const rows = (await scoped(TENANT_A, (tx) => tx`
      SELECT id FROM crm.journey_templates
      WHERE tenant_id = ${TENANT_A} AND template_key = ${templateKey}
    `)) as unknown as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect((await eventPayloads(TENANT_A, EVENTS.journeyTemplateCreated)).filter((p) => p.templateId === id))
      .toHaveLength(1);
  });
});

describe("crm.journey_template.update consumer", () => {
  it("amends a draft and reports the changed fields", async () => {
    const id = await seedTemplate(TENANT_A);
    const newSteps = [step("lead_captured", 10, { slaHours: 3 }), step("qualified", 20), step("agreed", 40)];
    await deliver(COMMANDS.updateJourneyTemplate, {
      id, tenantId: TENANT_A, name: "Amended", steps: newSteps, region: "east", version: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await templateRow(TENANT_A, id);
    expect(row?.name).toBe("Amended");
    expect(row?.steps[0]?.slaHours).toBe(3);
    expect(row?.version).toBe(2);

    const updated = (await eventPayloads(TENANT_A, EVENTS.journeyTemplateUpdated))
      .filter((p) => p.templateId === id);
    expect(updated[0]?.changed).toEqual(["name", "steps", "region"]);
  });

  it("applies a redelivered amendment exactly once", async () => {
    const id = await seedTemplate(TENANT_A);
    const messageId = randomUUID();
    const payload = { id, tenantId: TENANT_A, name: "Applied Once", version: 1 };
    await deliver(COMMANDS.updateJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.updateJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    expect((await templateRow(TENANT_A, id))?.version).toBe(2);
  });

  it("audits a stale version without emitting an event", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.updateJourneyTemplate, {
      id, tenantId: TENANT_A, name: "Never Applied", version: 99,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    expect((await templateRow(TENANT_A, id))?.name).toBe("Seeded Template");
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["version_conflict"]);
  });

  /**
   * The repo's `status = 'draft'` predicate matters here: without it a redelivered update
   * would reach the 0081 trigger on a since-published row and loop until it dead-lettered.
   */
  it("cannot amend a published definition — audited, not thrown", async () => {
    const id = await seedTemplate(TENANT_A, { status: "published" });
    await deliver(COMMANDS.updateJourneyTemplate, {
      id, tenantId: TENANT_A, name: "Rewriting History", steps: [step("qualified", 20)], version: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await templateRow(TENANT_A, id);
    expect(row?.name).toBe("Seeded Template");
    expect(row?.steps).toHaveLength(3);
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["version_conflict"]);
  });

  it("a command from tenant B cannot amend tenant A's template", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.updateJourneyTemplate, {
      id, tenantId: TENANT_B, name: "Hijacked", version: 1,
    }, { tenantId: TENANT_B, actorId: ACTOR_B });

    expect((await templateRow(TENANT_A, id))?.name).toBe("Seeded Template");
    expect(await auditOutcomes(TENANT_B, id)).toEqual(["version_conflict"]);
  });
});

describe("crm.journey_template.delete consumer", () => {
  it("soft-deletes a draft and emits the deleted event", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.deleteJourneyTemplate, { id, tenantId: TENANT_A }, {
      tenantId: TENANT_A, actorId: ACTOR_A,
    });

    expect((await templateRow(TENANT_A, id))?.deletedAt).not.toBeNull();
    expect((await eventPayloads(TENANT_A, EVENTS.journeyTemplateDeleted)).filter((p) => p.templateId === id))
      .toHaveLength(1);
  });

  it("refuses to delete a published definition — audited, not thrown", async () => {
    const id = await seedTemplate(TENANT_A, { status: "published" });
    await deliver(COMMANDS.deleteJourneyTemplate, { id, tenantId: TENANT_A }, {
      tenantId: TENANT_A, actorId: ACTOR_A,
    });

    expect((await templateRow(TENANT_A, id))?.deletedAt).toBeNull();
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["not_applicable"]);
  });

  it("a command from tenant B cannot delete tenant A's template", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.deleteJourneyTemplate, { id, tenantId: TENANT_B }, {
      tenantId: TENANT_B, actorId: ACTOR_B,
    });
    expect((await templateRow(TENANT_A, id))?.deletedAt).toBeNull();
  });
});

describe("crm.journey_template.publish consumer", () => {
  it("publishes a draft in place when no replacement steps are supplied", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.publishJourneyTemplate, {
      id, tenantId: TENANT_A, steps: null, newTemplateId: null, versionNumber: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await templateRow(TENANT_A, id);
    expect(row?.status).toBe("published");
    expect(row?.publishedAt).not.toBeNull();

    const published = (await eventPayloads(TENANT_A, EVENTS.journeyTemplatePublished))
      .filter((p) => p.templateId === id);
    expect(published).toHaveLength(1);
    expect(published[0]?.supersededTemplateId).toBeNull();
  });

  it("inserts a NEW version row and removes the draft it supersedes", async () => {
    const templateKey = `superseding_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const draftId = await seedTemplate(TENANT_A, { templateKey });
    const newId = randomUUID();
    const newSteps = [step("lead_captured", 10, { slaHours: 2 }), step("qualified", 20), step("agreed", 40)];

    await deliver(COMMANDS.publishJourneyTemplate, {
      id: draftId, tenantId: TENANT_A, steps: newSteps, newTemplateId: newId, versionNumber: 2,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const created = await templateRow(TENANT_A, newId);
    expect(created?.status).toBe("published");
    expect(created?.versionNumber).toBe(2);
    expect(created?.templateKey).toBe(templateKey);
    expect(created?.steps[0]?.slaHours).toBe(2);

    const draft = await templateRow(TENANT_A, draftId);
    expect(draft?.deletedAt, "a draft never was the live definition").not.toBeNull();

    const published = (await eventPayloads(TENANT_A, EVENTS.journeyTemplatePublished))
      .filter((p) => p.templateId === newId);
    expect(published[0]).toMatchObject({ versionNumber: 2, supersededTemplateId: draftId });
  });

  it("deprecates rather than deletes a published row it supersedes, leaving its steps intact", async () => {
    const templateKey = `historical_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const liveId = await seedTemplate(TENANT_A, { templateKey, status: "published" });
    const newId = randomUUID();

    await deliver(COMMANDS.publishJourneyTemplate, {
      id: liveId,
      tenantId: TENANT_A,
      steps: [step("lead_captured", 10, { slaHours: 1 }), step("qualified", 20), step("agreed", 40)],
      newTemplateId: newId,
      versionNumber: 2,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const old = await templateRow(TENANT_A, liveId);
    expect(old?.status).toBe("deprecated");
    expect(old?.deletedAt, "history stays readable").toBeNull();
    expect(old?.steps[0]?.slaHours, "the superseded definition is not rewritten").toBe(24);
    expect((await templateRow(TENANT_A, newId))?.status).toBe("published");
  });

  it("is a no-op on redelivery — no duplicate version row", async () => {
    const draftId = await seedTemplate(TENANT_A);
    const newId = randomUUID();
    const messageId = randomUUID();
    const payload = {
      id: draftId,
      tenantId: TENANT_A,
      steps: STEPS,
      newTemplateId: newId,
      versionNumber: 2,
    };

    await deliver(COMMANDS.publishJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.publishJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    expect(await templateRow(TENANT_A, newId)).toBeDefined();
    expect((await eventPayloads(TENANT_A, EVENTS.journeyTemplatePublished))
      .filter((p) => p.templateId === newId)).toHaveLength(1);
  });

  it("audits a publish of a template that is not there", async () => {
    const missing = randomUUID();
    await deliver(COMMANDS.publishJourneyTemplate, {
      id: missing, tenantId: TENANT_A, steps: null, newTemplateId: null, versionNumber: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    expect(await auditOutcomes(TENANT_A, missing)).toEqual(["not_found"]);
  });

  it("audits an in-place publish of a row that is no longer a draft", async () => {
    const id = await seedTemplate(TENANT_A, { status: "published" });
    await deliver(COMMANDS.publishJourneyTemplate, {
      id, tenantId: TENANT_A, steps: null, newTemplateId: null, versionNumber: 1,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    expect(await auditOutcomes(TENANT_A, id)).toEqual(["invalid_status"]);
    expect((await eventPayloads(TENANT_A, EVENTS.journeyTemplatePublished))
      .filter((p) => p.templateId === id)).toHaveLength(0);
  });

  it("a command from tenant B cannot publish tenant A's template", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.publishJourneyTemplate, {
      id, tenantId: TENANT_B, steps: null, newTemplateId: null, versionNumber: 1,
    }, { tenantId: TENANT_B, actorId: ACTOR_B });

    expect((await templateRow(TENANT_A, id))?.status).toBe("draft");
    expect(await auditOutcomes(TENANT_B, id)).toEqual(["not_found"]);
  });
});

describe("crm.journey_template.deprecate consumer", () => {
  it("retires a published version and carries the reason on the event", async () => {
    const id = await seedTemplate(TENANT_A, { status: "published" });
    await deliver(COMMANDS.deprecateJourneyTemplate, {
      id, tenantId: TENANT_A, reason: "superseded by the FY27 journey",
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    const row = await templateRow(TENANT_A, id);
    expect(row?.status).toBe("deprecated");
    expect(row?.deprecatedAt).not.toBeNull();

    const events = (await eventPayloads(TENANT_A, EVENTS.journeyTemplateDeprecated))
      .filter((p) => p.templateId === id);
    expect(events[0]).toMatchObject({ reason: "superseded by the FY27 journey", versionNumber: 1 });
  });

  it("is a no-op on redelivery", async () => {
    const id = await seedTemplate(TENANT_A, { status: "published" });
    const messageId = randomUUID();
    const payload = { id, tenantId: TENANT_A, reason: null };
    await deliver(COMMANDS.deprecateJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });
    await deliver(COMMANDS.deprecateJourneyTemplate, payload, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    expect(await auditOutcomes(TENANT_A, id)).toEqual(["success"]);
  });

  it("audits a deprecate of a template that is not there", async () => {
    const missing = randomUUID();
    await deliver(COMMANDS.deprecateJourneyTemplate, { id: missing, tenantId: TENANT_A, reason: null }, {
      tenantId: TENANT_A, actorId: ACTOR_A,
    });
    expect(await auditOutcomes(TENANT_A, missing)).toEqual(["not_found"]);
  });

  it("audits a deprecate of a draft — only a live definition can be retired", async () => {
    const id = await seedTemplate(TENANT_A);
    await deliver(COMMANDS.deprecateJourneyTemplate, { id, tenantId: TENANT_A, reason: null }, {
      tenantId: TENANT_A, actorId: ACTOR_A,
    });

    expect((await templateRow(TENANT_A, id))?.status).toBe("draft");
    expect(await auditOutcomes(TENANT_A, id)).toEqual(["invalid_status"]);
  });

  it("a command from tenant B cannot deprecate tenant A's template", async () => {
    const id = await seedTemplate(TENANT_A, { status: "published" });
    await deliver(COMMANDS.deprecateJourneyTemplate, { id, tenantId: TENANT_B, reason: null }, {
      tenantId: TENANT_B, actorId: ACTOR_B,
    });

    expect((await templateRow(TENANT_A, id))?.status).toBe("published");
    expect(await auditOutcomes(TENANT_B, id)).toEqual(["not_found"]);
  });
});

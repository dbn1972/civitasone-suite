/**
 * FQ12 metadata-service defects.
 *
 *  #98 #100 #101 #102 #104  PATCH of entities / fields / validation-rules / layouts /
 *       number-formats applied the change but left `version` at 1 (the update
 *       consumers never bumped it; records/consumer.ts does).
 *  #108 POST /v1/metadata/form-versions/:id/reject accepted `reason` and dropped it.
 *       It now rides on the form_reject_version audit event (newValue.reason), and the
 *       reject bumps the form version's row version like approve does.
 *
 * Rows are seeded under the tenant GUC, then the real update commands are pushed
 * through the worker's consumers on the in-memory bus.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { withTenant } from "../src/shared/scope.js";
import { COMMANDS } from "../src/topics.js";
import {
  entityDefinitions, fieldDefinitions, validationRules, layoutDefinitions,
} from "../src/modules/entities/schema.js";
import { numberFormats } from "../src/modules/numbering/schema.js";
import { formVersions } from "../src/modules/forms/schema.js";
import { registerConsumersOnce, drainQueue } from "./consumer-harness.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const ENTITY = randomUUID();
const FIELD = randomUUID();
const RULE = randomUUID();
const LAYOUT = randomUUID();
const NUMFMT = randomUUID();
const FORMV = randomUUID();
const REASON = `FQ12 reject reason ${randomUUID()}`;
const audit = { createdBy: ACTOR, updatedBy: ACTOR };

async function send(topic: string, payload: Record<string, unknown>): Promise<void> {
  await (queue as unknown as MemoryQueue).publish(topic, {
    messageId: randomUUID(), type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: TENANT, ...payload },
  });
  await drainQueue();
}

beforeAll(async () => {
  registerConsumersOnce();
  await queue.start();
  const tag = ENTITY.slice(0, 8);
  await withTenant(TENANT, async (tx) => {
    await tx.insert(entityDefinitions).values({ id: ENTITY, tenantId: TENANT, apiName: `fq12_${tag}`, label: "FQ12", pluralLabel: "FQ12s", ...audit });
    await tx.insert(fieldDefinitions).values({ id: FIELD, tenantId: TENANT, entityDefId: ENTITY, apiName: `f_${tag}`, label: "F", fieldType: "text", ...audit });
    await tx.insert(validationRules).values({ id: RULE, tenantId: TENANT, entityDefId: ENTITY, name: "r", expression: "1 == 1", errorMessage: "e", ...audit });
    await tx.insert(layoutDefinitions).values({ id: LAYOUT, tenantId: TENANT, entityDefId: ENTITY, ...audit });
    await tx.insert(numberFormats).values({ id: NUMFMT, tenantId: TENANT, formatKey: `fq12.${tag}`, label: "NF", ...audit });
    await tx.insert(formVersions).values({ id: FORMV, tenantId: TENANT, layoutDefId: LAYOUT, versionNumber: 1, status: "pending_approval", submittedBy: ACTOR, submittedAt: new Date(), ...audit });
  });
});

describe("FQ12 metadata — version bumped on PATCH", () => {
  const cases = [
    { name: "entity (#98)", topic: "metadata.entity.update", table: entityDefinitions, id: ENTITY, payload: { label: "FQ12 upd" }, col: "label", value: "FQ12 upd" },
    { name: "field (#100)", topic: COMMANDS.FIELD_UPDATE, table: fieldDefinitions, id: FIELD, payload: { label: "F upd" }, col: "label", value: "F upd" },
    { name: "validation rule (#101)", topic: COMMANDS.RULE_UPDATE, table: validationRules, id: RULE, payload: { name: "r upd" }, col: "name", value: "r upd" },
    { name: "layout (#102)", topic: COMMANDS.LAYOUT_UPDATE, table: layoutDefinitions, id: LAYOUT, payload: { isDefault: true }, col: "isDefault", value: true },
    { name: "number format (#104)", topic: COMMANDS.NUMBER_FORMAT_UPDATE, table: numberFormats, id: NUMFMT, payload: { label: "NF upd" }, col: "label", value: "NF upd" },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: each update applies and increments version`, async () => {
      const read = async () => (await withTenant(TENANT, (tx) =>
        tx.select().from(c.table as typeof entityDefinitions).where(eq((c.table as typeof entityDefinitions).id, c.id))))[0] as Record<string, unknown>;
      expect((await read()).version).toBe(1);
      await send(c.topic, { id: c.id, ...c.payload });
      const after = await read();
      expect(after[c.col]).toBe(c.value);
      expect(after.version).toBe(2);
      await send(c.topic, { id: c.id, ...c.payload });
      expect((await read()).version).toBe(3);
    });
  }
});

describe("FQ12 metadata — form-version reject reason (#108)", () => {
  it("returns the version to draft, bumps its version and records the reason on the audit event", async () => {
    await send(COMMANDS.FORM_MUTATE, { op: "reject_version", id: FORMV, reason: REASON });
    const [row] = await withTenant(TENANT, (tx) => tx.select().from(formVersions).where(eq(formVersions.id, FORMV)));
    expect(row?.status).toBe("draft");
    expect(row?.version).toBe(2);
    const events = await withTenant(TENANT, (tx) => tx.execute(sql`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND payload->>'action' = 'form_reject_version'`));
    const rows = (Array.isArray(events) ? events : (events as unknown as { rows: unknown[] }).rows) as Array<{ payload: Record<string, unknown> }>;
    expect(rows.map((r) => r.payload.newValue)).toContainEqual({ reason: REASON });
  });
});

/**
 * GAP-COURT-CAUSE-LIST-03 (owner decision #33): cause-list slots and courtrooms come from PER-COURT config
 * namespaces, seeded with defaults when a court is created; listing a case on a slot / courtroom that is not
 * configured for that court is refused (route 422, consumer NonRetryable). Real DB (RLS), real consumers.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerCourtRegistryConsumers } from "../src/modules/court-registry/consumer.js";
import { registerCauseListConsumers } from "../src/modules/cause-list/consumer.js";
import { deriveCauseListId, deriveItemId, slotNamespace, courtroomNamespace } from "../src/modules/cause-list/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const ACTOR = randomUUID();
const SEEDED_COURT = randomUUID();   // created through the consumer -> seeded with defaults
const LEGACY_COURT = randomUUID();   // inserted by SQL, never seeded -> defaults apply as the fallback
const CUSTOM_COURT = randomUUID();   // tenant-configured slots/courtrooms (authoritative)
const LIST_DATE = "2026-11-02";
const CASE_ID = randomUUID();
const CASE_2 = randomUUID();

const hdr = (roles = ["registrar"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "s-d33" }, SECRET, 3600)}`,
  "x-tenant-id": T, "content-type": "application/json",
});

let app: FastifyInstance;
let q: Queue;

const listId = (court: string) => deriveCauseListId(T, court, LIST_DATE);
const addItem = (court: string, body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/court/cause-lists/${listId(court)}/items`, headers: hdr(), payload: { caseId: CASE_ID, itemNumber: 1, ...body } });
const configKeys = async (ns: string) => {
  const res = await app.inject({ method: "GET", url: `/v1/court/config/${ns}`, headers: hdr() });
  expect(res.statusCode).toBe(200);
  return (res.json().items as Array<{ configKey: string }>).map((i) => i.configKey);
};

async function cleanup() {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    await sql`DELETE FROM court.cause_list_items WHERE tenant_id = ${T}`;
    await sql`DELETE FROM court.cause_lists WHERE tenant_id = ${T}`;
    await sql`DELETE FROM court.config_entries WHERE tenant_id = ${T}`;
    await sql`DELETE FROM court.cases WHERE tenant_id = ${T}`;
    await sql`DELETE FROM court.courts WHERE tenant_id = ${T}`;
    await sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  const register = (topic: string, handler: unknown) => (q.subscribe as unknown as (t: string, h: unknown) => void)(topic, handler);
  registerCourtRegistryConsumers(register);
  registerCauseListConsumers(register);
  await q.start();

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    for (const [id, name] of [[LEGACY_COURT, "Legacy Court"], [CUSTOM_COURT, "Custom Court"]] as const) {
      await sql`INSERT INTO court.courts (id, tenant_id, name, court_type) VALUES (${id}, ${T}, ${name}, 'revenue_court')`;
    }
    for (const [id, cnr] of [[CASE_ID, "CNR-A"], [CASE_2, "CNR-B"]] as const) {
      await sql`INSERT INTO court.cases (id, tenant_id, cnr_number, case_type, status, title) VALUES (${id}, ${T}, ${cnr + id.slice(0, 6)}, 'civil', 'filed', 'Matter')`;
    }
    for (const court of [LEGACY_COURT, CUSTOM_COURT]) {
      await sql`INSERT INTO court.cause_lists (id, tenant_id, court_id, list_date, status) VALUES (${listId(court)}, ${T}, ${court}, ${LIST_DATE}, 'draft')`;
    }
    // CUSTOM_COURT: the tenant configured its own slots + courtrooms (authoritative: replaces the defaults).
    for (const [ns, key] of [[slotNamespace(CUSTOM_COURT), "MORNING"], [slotNamespace(CUSTOM_COURT), "AFTERNOON"], [courtroomNamespace(CUSTOM_COURT), "HALL-A"]] as const) {
      await sql`INSERT INTO court.config_entries (id, tenant_id, namespace, config_key, value, active, sort_order, created_by, updated_by)
        VALUES (${randomUUID()}, ${T}, ${ns}, ${key}, '{}'::jsonb, true, 0, ${ACTOR}, ${ACTOR})`;
    }
  });
  // SEEDED_COURT: created through the real consumer, which must seed the per-court defaults.
  await q.publish(COMMANDS.createCourt, {
    messageId: randomUUID(), type: COMMANDS.createCourt, tenantId: T, actorId: ACTOR, correlationId: "corr-d33", schemaVersion: "1.0",
    payload: { id: SEEDED_COURT, tenantId: T, name: "Seeded Court", courtType: "revenue_court" },
  });
  await new Promise((r) => setTimeout(r, 800));
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${T}, true)`;
    await sql`INSERT INTO court.cause_lists (id, tenant_id, court_id, list_date, status) VALUES (${listId(SEEDED_COURT)}, ${T}, ${SEEDED_COURT}, ${LIST_DATE}, 'draft')`;
  });
});
afterAll(async () => {
  await q.stop();
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("per-court slot / courtroom config (owner decision #33)", () => {
  it("creating a court seeds its slot and courtroom namespaces with the defaults", async () => {
    expect(await configKeys(slotNamespace(SEEDED_COURT))).toEqual(["AM-1", "AM-2", "PM-1", "PM-2"]);
    expect(await configKeys(courtroomNamespace(SEEDED_COURT))).toEqual(["COURT-1"]);
  });

  it("the seeding is per court: another court's namespace is untouched", async () => {
    expect(await configKeys(slotNamespace(LEGACY_COURT))).toEqual([]);
  });

  it("a seeded court accepts a configured slot + courtroom (202) and refuses anything else (422)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    expect((await addItem(SEEDED_COURT, { slot: "AM-1", courtroom: "COURT-1" })).statusCode).toBe(202);
    const badSlot = await addItem(SEEDED_COURT, { slot: "ZZ-9", courtroom: "COURT-1" });
    expect(badSlot.statusCode).toBe(422);
    expect(badSlot.json().error.code).toBe("CAUSELIST_SLOT_NOT_CONFIGURED");
    const badRoom = await addItem(SEEDED_COURT, { slot: "AM-1", courtroom: "NOPE" });
    expect(badRoom.statusCode).toBe(422);
    expect(badRoom.json().error.code).toBe("CAUSELIST_COURTROOM_NOT_CONFIGURED");
    expect(spy.mock.calls.filter((c) => c[0] === COMMANDS.listCaseOnCauseList)).toHaveLength(1);
    spy.mockRestore();
  });

  it("a court that was never seeded falls back to the defaults (legacy courts keep working)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    expect((await addItem(LEGACY_COURT, { slot: "PM-2", courtroom: "COURT-1" })).statusCode).toBe(202);
    expect((await addItem(LEGACY_COURT, { slot: "10:30", courtroom: "COURT-1" })).statusCode).toBe(422);
    spy.mockRestore();
  });

  it("tenant-configured values are AUTHORITATIVE for that court: the defaults stop being valid", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    expect((await addItem(CUSTOM_COURT, { slot: "MORNING", courtroom: "HALL-A" })).statusCode).toBe(202);
    expect((await addItem(CUSTOM_COURT, { slot: "AM-1", courtroom: "HALL-A" })).statusCode).toBe(422);
    expect((await addItem(CUSTOM_COURT, { slot: "MORNING", courtroom: "COURT-1" })).statusCode).toBe(422);
    spy.mockRestore();
  });

  it("a slot that is valid for another court is NOT valid here (config is per court)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    expect((await addItem(SEEDED_COURT, { slot: "MORNING", courtroom: "COURT-1" })).statusCode).toBe(422);
    spy.mockRestore();
  });

  it("the consumer re-validates (defence in depth): an unconfigured slot never reaches the table", async () => {
    // Same deterministic item id the route would mint for (list, case): the rejected command and the accepted
    // one are DIFFERENT messages (own messageIds) but the same listing, so only the valid one may land.
    const okId = deriveItemId(T, listId(SEEDED_COURT), CASE_2);
    await q.publish(COMMANDS.listCaseOnCauseList, {
      messageId: randomUUID(), type: COMMANDS.listCaseOnCauseList, tenantId: T, actorId: ACTOR, correlationId: "corr-bad", schemaVersion: "1.0",
      payload: { id: okId, causeListId: listId(SEEDED_COURT), tenantId: T, caseId: CASE_2, itemNumber: 7, slot: "ZZ-9", courtroom: "COURT-1" },
    });
    await q.publish(COMMANDS.listCaseOnCauseList, {
      messageId: randomUUID(), type: COMMANDS.listCaseOnCauseList, tenantId: T, actorId: ACTOR, correlationId: "corr-ok", schemaVersion: "1.0",
      payload: { id: okId, causeListId: listId(SEEDED_COURT), tenantId: T, caseId: CASE_2, itemNumber: 8, slot: "PM-1", courtroom: "COURT-1" },
    });
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      return sql`SELECT id, slot FROM court.cause_list_items WHERE tenant_id = ${T}`;
    });
    expect(rows.map((r) => r.id)).toEqual([okId]);
    expect(rows[0]!.slot).toBe("PM-1");
  });

  it("an identical resubmission of an already-listed item is not re-validated away (idempotent retry)", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    const res = await addItem(SEEDED_COURT, { caseId: CASE_2, itemNumber: 8, slot: "PM-1", courtroom: "COURT-1" });
    expect(res.statusCode).toBe(202);
    spy.mockRestore();
  });
});

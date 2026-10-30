/**
 * UAT F75 / F76 (silent data loss, works masters).
 *
 *  F75: POST /v1/works/masters/issue-description-types was validated by the
 *       generic {name, code, active} schema, which stripped issueTypeId, while
 *       works.issue_description_types.issue_type_id is NOT NULL.
 *  F76: POST /v1/works/masters/work-description-types was validated by the
 *       same schema, which stripped workTypeId + keyword, while
 *       works.work_description_types requires both and has no name column.
 *
 * Both returned 202 and the consumer insert then failed on every delivery, so
 * the tables stayed empty on UAT and the matching PATCH routes could never be
 * exercised. These tests drive the real route (fastify inject), capture the
 * published command, deliver it to the REAL masters consumer against the REAL
 * Postgres (works_svc, FORCE RLS), and assert the row, the list read-back and
 * a PATCH round-trip. They also prove a NOT NULL violation in the consumer is
 * a NonRetryableError that leaves no row and no inbox marker behind.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { isNonRetryable } from "@civitasone/queue";
import { processed } from "@civitasone/outbox";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerMasterConsumers } from "../src/modules/masters/consumer.js";
import { issueDescriptionTypes, workDescriptionTypes } from "../src/modules/masters/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const ISSUE_TYPE_ID = randomUUID();
const WORK_TYPE_ID = randomUUID();

type Envelope = { messageId: string; tenantId: string; payload: Record<string, unknown> };
type Handler = (msg: unknown) => Promise<void>;

const handlers: Record<string, Handler> = {};
registerMasterConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);

const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["works_admin"], sid: "s" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
const messageIds: string[] = [];

/** Call the route with queue.publish captured; return the response and the published envelope. */
async function callAndCapture(method: "POST" | "PATCH", url: string, payload: unknown) {
  const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
  try {
    const res = await app.inject({ method, url, headers: hdr(), payload: payload as Record<string, unknown> });
    const envelope = spy.mock.calls[0]?.[1] as Envelope | undefined;
    if (envelope) messageIds.push(envelope.messageId);
    return { res, envelope, topic: spy.mock.calls[0]?.[0] as string | undefined };
  } finally {
    spy.mockRestore();
  }
}

/** Deliver a command the way the worker does: inside the message's tenant scope. */
function deliver(topic: string, envelope: unknown): Promise<void> {
  return runWithTenant(TENANT, () => handlers[topic]!(envelope));
}

function readRows<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(issueDescriptionTypes).where(eq(issueDescriptionTypes.tenantId, TENANT));
    await tx.delete(workDescriptionTypes).where(eq(workDescriptionTypes.tenantId, TENANT));
  })).catch(() => undefined);
  if (messageIds.length > 0) {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(processed).where(inArray(processed.messageId, messageIds)))).catch(() => undefined);
  }
  await app.close();
  await sqlClient.end();
});

describe("UAT F75: issue-description-types create + PATCH persist (real DB)", () => {
  let id = "";

  it("POST {name, issueTypeId} -> 202, and the consumer persists the row with issue_type_id", async () => {
    const { res, envelope, topic } = await callAndCapture("POST", "/v1/works/masters/issue-description-types", {
      name: "F75 cracked slab", issueTypeId: ISSUE_TYPE_ID,
    });
    expect(res.statusCode).toBe(202);
    expect(topic).toBe(COMMANDS.masterCreate);
    expect(envelope?.payload).toMatchObject({ masterType: "issue-description-types", name: "F75 cracked slab", issueTypeId: ISSUE_TYPE_ID });
    id = String(envelope!.payload.id);

    await deliver(COMMANDS.masterCreate, envelope);

    const rows = await readRows((tx) => tx.select().from(issueDescriptionTypes).where(eq(issueDescriptionTypes.id, id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, tenantId: TENANT, issueTypeId: ISSUE_TYPE_ID, name: "F75 cracked slab", active: true, version: 1 });
  });

  it("GET list returns the row with issueTypeId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/issue-description-types", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({ id, issueTypeId: ISSUE_TYPE_ID, name: "F75 cracked slab" });
  });

  it("PATCH {name, version} -> 202, and the consumer updates the row (version bumped)", async () => {
    const { res, envelope, topic } = await callAndCapture("PATCH", `/v1/works/masters/issue-description-types/${id}`, {
      name: "F75 cracked slab (renamed)", version: 1,
    });
    expect(res.statusCode).toBe(202);
    expect(topic).toBe(COMMANDS.masterUpdate);
    await deliver(COMMANDS.masterUpdate, envelope);

    const rows = await readRows((tx) => tx.select().from(issueDescriptionTypes).where(eq(issueDescriptionTypes.id, id)));
    expect(rows[0]).toMatchObject({ name: "F75 cracked slab (renamed)", issueTypeId: ISSUE_TYPE_ID, version: 2 });
  });

  it("POST without issueTypeId -> 400 (no longer a 202 that can never persist)", async () => {
    const { res, envelope } = await callAndCapture("POST", "/v1/works/masters/issue-description-types", { name: "orphan" });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
  });
});

describe("UAT F76: work-description-types create + PATCH persist (real DB)", () => {
  let id = "";

  it("POST {keyword, workTypeId} -> 202, and the consumer persists keyword + work_type_id", async () => {
    const { res, envelope } = await callAndCapture("POST", "/v1/works/masters/work-description-types", {
      keyword: "F76 resurfacing", workTypeId: WORK_TYPE_ID,
    });
    expect(res.statusCode).toBe(202);
    expect(envelope?.payload).toMatchObject({ masterType: "work-description-types", keyword: "F76 resurfacing", workTypeId: WORK_TYPE_ID });
    id = String(envelope!.payload.id);

    await deliver(COMMANDS.masterCreate, envelope);

    const rows = await readRows((tx) => tx.select().from(workDescriptionTypes).where(eq(workDescriptionTypes.id, id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, tenantId: TENANT, workTypeId: WORK_TYPE_ID, keyword: "F76 resurfacing", active: true, version: 1 });
  });

  it("GET list returns the row with keyword + workTypeId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/masters/work-description-types", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({ id, keyword: "F76 resurfacing", workTypeId: WORK_TYPE_ID });
  });

  it("PATCH {name} -> 400: the table has no name column, so this used to be a silent no-op", async () => {
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/work-description-types/${id}`, { name: "x", version: 1 });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
  });

  it("PATCH {keyword, version} -> 202, and the consumer updates the keyword (version bumped)", async () => {
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/work-description-types/${id}`, {
      keyword: "F76 resurfacing (bituminous)", version: 1,
    });
    expect(res.statusCode).toBe(202);
    await deliver(COMMANDS.masterUpdate, envelope);

    const rows = await readRows((tx) => tx.select().from(workDescriptionTypes).where(eq(workDescriptionTypes.id, id)));
    expect(rows[0]).toMatchObject({ keyword: "F76 resurfacing (bituminous)", workTypeId: WORK_TYPE_ID, version: 2 });
  });

  it("POST with only {name} (the old shape) -> 400", async () => {
    const { res, envelope } = await callAndCapture("POST", "/v1/works/masters/work-description-types", { name: "old shape" });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
  });
});

describe("UAT F75/F76: a NOT NULL violation in the masters consumer is non-retryable, not silent", () => {
  it("a create command missing issueTypeId throws NonRetryableError; no row and no inbox marker remain", async () => {
    const messageId = randomUUID();
    messageIds.push(messageId);
    const rowId = randomUUID();
    const envelope = {
      messageId, tenantId: TENANT, actorId: ACTOR, correlationId: `f75-${messageId}`, schemaVersion: "1.0",
      type: COMMANDS.masterCreate,
      payload: { id: rowId, masterType: "issue-description-types", name: "crafted without parent" },
    };

    let caught: unknown;
    try {
      await deliver(COMMANDS.masterCreate, envelope);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isNonRetryable(caught)).toBe(true);
    expect((caught as Error).message).toContain("23502");
    expect((caught as Error).message).toContain("issue_type_id");

    const rows = await readRows((tx) => tx.select().from(issueDescriptionTypes).where(eq(issueDescriptionTypes.id, rowId)));
    expect(rows).toHaveLength(0);
    const marker = await readRows((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId)));
    expect(marker).toHaveLength(0);
  });
});

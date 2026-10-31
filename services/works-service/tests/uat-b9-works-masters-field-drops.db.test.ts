/**
 * UAT B9-works (silent field drops, works masters).
 *
 * After F75/F76 the masters create/PATCH paths still lost submitted fields:
 *  - POST user-departments {demandNumber} and contractor-classes {description}
 *    were validated by the generic {name, code, active} schema, which stripped
 *    the field although works.user_departments.demand_number and
 *    works.contractor_classes.description exist: 202, stored as NULL.
 *  - POST proposer-types (and programs, publication-levels, issue-types,
 *    user-departments, contractor-classes) {code} was accepted, but those
 *    tables have no code column, so drizzle ignored it: 202, value lost.
 *  - PATCH {code} on those tables (and {name} on sr-items) used the shared
 *    name/code/active patch schema: 202, version bumped, nothing changed.
 *
 * These tests drive the real route (fastify inject), capture the published
 * command, deliver it to the REAL masters consumer against the REAL Postgres
 * (works_svc, FORCE RLS) and assert the stored row. A field the table cannot
 * store must now be a 400 with nothing published.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { processed } from "@civitasone/outbox";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerMasterConsumers } from "../src/modules/masters/consumer.js";
import { contractorClasses, proposerTypes, srItems, userDepartments } from "../src/modules/masters/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();

type Envelope = { messageId: string; tenantId: string; payload: Record<string, unknown> };
type Handler = (msg: unknown) => Promise<void>;

const handlers: Record<string, Handler> = {};
registerMasterConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);

const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["works_admin"], sid: "s" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
const messageIds: string[] = [];

async function callAndCapture(method: "POST" | "PATCH", url: string, payload: unknown) {
  const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
  try {
    const res = await app.inject({ method, url, headers: hdr(), payload: payload as Record<string, unknown> });
    const envelope = spy.mock.calls[0]?.[1] as Envelope | undefined;
    if (envelope) messageIds.push(envelope.messageId);
    return { res, envelope };
  } finally {
    spy.mockRestore();
  }
}

function deliver(topic: string, envelope: unknown): Promise<void> {
  return runWithTenant(TENANT, () => handlers[topic]!(envelope));
}

function readRows<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
}

/** POST, deliver the published command to the real consumer, return the new row id. */
async function create(prefix: string, body: Record<string, unknown>): Promise<string> {
  const { res, envelope } = await callAndCapture("POST", `/v1/works/masters/${prefix}`, body);
  expect(res.statusCode).toBe(202);
  await deliver(COMMANDS.masterCreate, envelope);
  return String(envelope!.payload.id);
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(userDepartments).where(eq(userDepartments.tenantId, TENANT));
    await tx.delete(contractorClasses).where(eq(contractorClasses.tenantId, TENANT));
    await tx.delete(proposerTypes).where(eq(proposerTypes.tenantId, TENANT));
    await tx.delete(srItems).where(eq(srItems.tenantId, TENANT));
  })).catch(() => undefined);
  if (messageIds.length > 0) {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(processed).where(inArray(processed.messageId, messageIds)))).catch(() => undefined);
  }
  await app.close();
  await sqlClient.end();
});

describe("UAT B9-works: user-departments demand_number is persisted, not dropped", () => {
  let id = "";

  it("POST {name, demandNumber} stores demand_number", async () => {
    id = await create("user-departments", { name: "B9 PWD North", demandNumber: "H-07" });
    const rows = await readRows((tx) => tx.select().from(userDepartments).where(eq(userDepartments.id, id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "B9 PWD North", demandNumber: "H-07", version: 1 });
  });

  it("PATCH {demandNumber} updates demand_number", async () => {
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/user-departments/${id}`, { demandNumber: "H-08", version: 1 });
    expect(res.statusCode).toBe(202);
    await deliver(COMMANDS.masterUpdate, envelope);
    const rows = await readRows((tx) => tx.select().from(userDepartments).where(eq(userDepartments.id, id)));
    expect(rows[0]).toMatchObject({ demandNumber: "H-08", version: 2 });
  });

  it("POST {name, code} -> 400 (no code column), nothing published", async () => {
    const { res, envelope } = await callAndCapture("POST", "/v1/works/masters/user-departments", { name: "B9 coded", code: "UD1" });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
  });
});

describe("UAT B9-works: contractor-classes description is persisted, not dropped", () => {
  let id = "";

  it("POST {name, description} stores description", async () => {
    id = await create("contractor-classes", { name: "B9 Class A", description: "Works above 1.5 crore" });
    const rows = await readRows((tx) => tx.select().from(contractorClasses).where(eq(contractorClasses.id, id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "B9 Class A", description: "Works above 1.5 crore", version: 1 });
  });

  it("PATCH {description} updates description", async () => {
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/contractor-classes/${id}`, { description: "Works above 2 crore", version: 1 });
    expect(res.statusCode).toBe(202);
    await deliver(COMMANDS.masterUpdate, envelope);
    const rows = await readRows((tx) => tx.select().from(contractorClasses).where(eq(contractorClasses.id, id)));
    expect(rows[0]).toMatchObject({ description: "Works above 2 crore", version: 2 });
  });
});

describe("UAT B9-works: a field the table cannot store is a 400, never a silent 202", () => {
  let proposerId = "";

  it("POST proposer-types {name, code} -> 400, nothing published", async () => {
    const { res, envelope } = await callAndCapture("POST", "/v1/works/masters/proposer-types", { name: "B9 MLA", code: "MLA" });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
  });

  it("PATCH proposer-types {code} -> 400 and the row is unchanged (it used to bump version and change nothing)", async () => {
    proposerId = await create("proposer-types", { name: "B9 MP" });
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/proposer-types/${proposerId}`, { code: "MP", version: 1 });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
    const rows = await readRows((tx) => tx.select().from(proposerTypes).where(eq(proposerTypes.id, proposerId)));
    expect(rows[0]).toMatchObject({ name: "B9 MP", version: 1 });
  });

  it("PATCH proposer-types {name} still works", async () => {
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/proposer-types/${proposerId}`, { name: "B9 Member of Parliament", version: 1 });
    expect(res.statusCode).toBe(202);
    await deliver(COMMANDS.masterUpdate, envelope);
    const rows = await readRows((tx) => tx.select().from(proposerTypes).where(eq(proposerTypes.id, proposerId)));
    expect(rows[0]).toMatchObject({ name: "B9 Member of Parliament", version: 2 });
  });

  it("PATCH sr-items {name} -> 400 (sr_items has no name column)", async () => {
    const srId = await create("sr-items", {
      zone: "N", srYear: "2026-27", itemCode: "B9-1", description: "Excavation", unit: "cum", rate: "4500000",
    });
    const { res, envelope } = await callAndCapture("PATCH", `/v1/works/masters/sr-items/${srId}`, { name: "x", version: 1 });
    expect(res.statusCode).toBe(400);
    expect(envelope).toBeUndefined();
  });
});

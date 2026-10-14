/**
 * One DAK, one file; a parent file must exist — against a real database.
 *
 * GAP-ESTAB-FILES-NEW-02: a file could be opened for a DAK already linked to another file (from the
 * DAK page, or from "new file" with a typed DAK number), and a parent file id was never checked.
 * Given a DAK that is available, one already linked, a missing one and another tenant's, When a file
 * is created/opened for each through the HTTP boundary, Then only the available one is accepted
 * (409 for the linked one, 404 for the missing and the foreign), a parent file must exist in the
 * tenant, and — through the real consumer — two simultaneous openings of one DAK produce one file.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabInward } from "../src/modules/files/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff33aa-0000-4000-8000-0000000005c1";
const OTHER = "c0ff33aa-0000-4000-8000-0000000005c2";
const ACTOR = randomUUID();

const AVAILABLE = randomUUID();
const LINKED = randomUUID();
const FOREIGN = randomUUID();
const LINKED_FILE = randomUUID();
const PARENT = randomUUID();
const FOREIGN_PARENT = randomUUID();
const MISSING = randomUUID();

const headers = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["estab_officer"], sid: "sess-one-file" }, SECRET)}`,
  "x-tenant-id": TENANT,
});

let app: FastifyInstance;

async function wipe(tx: typeof sqlClient) {
  for (const t of [TENANT, OTHER]) {
    await tx`select set_config('app.tenant_id', ${t}, true)`;
    await tx`UPDATE files.estab_inward SET file_id = NULL WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_notings WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_inward_movements WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_inward WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_files WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_doc_seq WHERE tenant_id = ${t}`;
  }
}

async function seed() {
  await sqlClient.begin(async (sql0) => {
    const tx = sql0 as unknown as typeof sqlClient;
    await wipe(tx);
    await tx`select set_config('app.tenant_id', ${TENANT}, true)`;
    for (const [id, no] of [[PARENT, "P/1"], [LINKED_FILE, "L/1"]] as const) {
      await tx`INSERT INTO files.estab_files (id, tenant_id, file_no, subject, dept, current_with, status, created_by, updated_by)
               VALUES (${id}, ${TENANT}, ${no}, ${"Subject " + no}, 'ADMIN', ${ACTOR}, 'active', ${ACTOR}, ${ACTOR})`;
    }
    await tx`INSERT INTO files.estab_inward (id, tenant_id, dak_no, from_address, subject, status, created_by, updated_by)
             VALUES (${AVAILABLE}, ${TENANT}, 'DAK/1', 'Ministry', 'Free DAK', 'received', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO files.estab_inward (id, tenant_id, dak_no, from_address, subject, status, file_id, file_ref, created_by, updated_by)
             VALUES (${LINKED}, ${TENANT}, 'DAK/2', 'Ministry', 'Linked DAK', 'file_opened', ${LINKED_FILE}, 'L/1', ${ACTOR}, ${ACTOR})`;
    await tx`select set_config('app.tenant_id', ${OTHER}, true)`;
    await tx`INSERT INTO files.estab_files (id, tenant_id, file_no, subject, dept, current_with, status, created_by, updated_by)
             VALUES (${FOREIGN_PARENT}, ${OTHER}, 'X/1', 'Foreign parent', 'ADMIN', ${ACTOR}, 'active', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO files.estab_inward (id, tenant_id, dak_no, from_address, subject, status, created_by, updated_by)
             VALUES (${FOREIGN}, ${OTHER}, 'DAK/X', 'Other', 'Foreign DAK', 'received', ${ACTOR}, ${ACTOR})`;
  });
}

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (s) => { await wipe(s as unknown as typeof sqlClient); });
  await sqlClient.end();
});
beforeEach(seed);

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: headers(), payload: payload as object });
const OPEN = { dept: "ADMIN", classification: "public" };
const NEW_FILE = { subject: "A new file", dept: "ADMIN", classification: "public" };

describe("POST /v1/estab/inward/:id/open-file — one DAK, one file", () => {
  it("accepts an available DAK", async () => {
    expect((await post(`/v1/estab/inward/${AVAILABLE}/open-file`, OPEN)).statusCode).toBe(202);
  });

  it("refuses a DAK already linked to a file with 409 DAK_ALREADY_LINKED", async () => {
    const res = await post(`/v1/estab/inward/${LINKED}/open-file`, OPEN);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "DAK_ALREADY_LINKED" });
  });

  it("refuses a missing DAK, and another tenant's DAK, with 404", async () => {
    for (const id of [MISSING, FOREIGN]) {
      const res = await post(`/v1/estab/inward/${id}/open-file`, OPEN);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "INWARD_NOT_FOUND" });
    }
  });
});

describe("POST /v1/estab/files — DAK and parent file checks", () => {
  it("accepts a file for an available DAK and for a real parent file", async () => {
    expect((await post("/v1/estab/files", { ...NEW_FILE, inwardId: AVAILABLE })).statusCode).toBe(202);
    expect((await post("/v1/estab/files", { ...NEW_FILE, parentFileId: PARENT })).statusCode).toBe(202);
  });

  it("a second file for an already-linked DAK returns 409", async () => {
    const res = await post("/v1/estab/files", { ...NEW_FILE, inwardId: LINKED });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "DAK_ALREADY_LINKED" });
  });

  it("a nonexistent parent file, or another tenant's, returns 404", async () => {
    for (const parentFileId of [MISSING, FOREIGN_PARENT]) {
      const res = await post("/v1/estab/files", { ...NEW_FILE, parentFileId });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "PARENT_FILE_NOT_FOUND" });
    }
  });

  it("a file with no DAK and no parent is unaffected", async () => {
    expect((await post("/v1/estab/files", NEW_FILE)).statusCode).toBe(202);
  });
});

function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
const env = (type: string, payload: Record<string, unknown>) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};
async function waitProcessed(messageId: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId))));
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}
const filesForInward = (inwardId: string) =>
  runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(estabFiles).where(eq(estabFiles.inwardId, inwardId))));
const inwardRow = async (id: string) =>
  (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(estabInward).where(eq(estabInward.id, id)))))[0];

describe("the files consumer — two simultaneous openings of one DAK produce one file", () => {
  it("Given two accepted open-file commands for the same DAK, Then exactly one file exists and the DAK points at it", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const a = env(COMMANDS.inwardOpenFile, { id: randomUUID(), inwardId: AVAILABLE, tenantId: TENANT, dept: "ADMIN", currentWith: ACTOR, classification: "public" });
    const b = env(COMMANDS.inwardOpenFile, { id: randomUUID(), inwardId: AVAILABLE, tenantId: TENANT, dept: "ADMIN", currentWith: ACTOR, classification: "public" });
    await Promise.all([q.publish(COMMANDS.inwardOpenFile, a), q.publish(COMMANDS.inwardOpenFile, b)]);
    await Promise.all([waitProcessed(a.messageId), waitProcessed(b.messageId)]);
    await q.stop();
    const files = await filesForInward(AVAILABLE);
    expect(files).toHaveLength(1);
    expect((await inwardRow(AVAILABLE))?.fileId).toBe(files[0]!.id);
  });

  it("Given a file-create command for a DAK that is already linked, Then no second file is created", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const m = env(COMMANDS.fileCreate, { id: randomUUID(), tenantId: TENANT, section: "ADMIN", subject: "Second file", dept: "ADMIN", priority: "normal", classification: "public", currentWith: ACTOR, inwardId: LINKED });
    await q.publish(COMMANDS.fileCreate, m);
    await waitProcessed(m.messageId);
    await q.stop();
    expect(await filesForInward(LINKED)).toHaveLength(0);
    expect((await inwardRow(LINKED))?.fileId).toBe(LINKED_FILE);
  });

  it("a dropped command leaves a failure audit row, never a silent no-op (create for a linked DAK, open-file for a linked and a missing DAK)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const create = env(COMMANDS.fileCreate, { id: randomUUID(), tenantId: TENANT, section: "ADMIN", subject: "Dup", dept: "ADMIN", priority: "normal", classification: "public", currentWith: ACTOR, inwardId: LINKED });
    const openLinked = env(COMMANDS.inwardOpenFile, { id: randomUUID(), inwardId: LINKED, tenantId: TENANT, dept: "ADMIN", currentWith: ACTOR, classification: "public" });
    const openMissing = env(COMMANDS.inwardOpenFile, { id: randomUUID(), inwardId: MISSING, tenantId: TENANT, dept: "ADMIN", currentWith: ACTOR, classification: "public" });
    await q.publish(COMMANDS.fileCreate, create);
    await q.publish(COMMANDS.inwardOpenFile, openLinked);
    await q.publish(COMMANDS.inwardOpenFile, openMissing);
    await Promise.all([create, openLinked, openMissing].map((m) => waitProcessed(m.messageId)));
    await q.stop();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`)));
    const ids = [create, openLinked, openMissing].map((m) => (m.payload as { id: string }).id);
    const skipped = (rows as unknown as Array<{ payload: { action: string; outcome: string; resourceId: string; metadata: { reason: string } } }>)
      .map((r) => r.payload).filter((p) => p.action === "create_skipped" && ids.includes(p.resourceId));
    expect(skipped).toHaveLength(3);
    expect(skipped.every((p) => p.outcome === "failure")).toBe(true);
    expect(skipped.map((p) => p.metadata.reason).sort()).toEqual(["dak_already_linked", "dak_already_linked", "dak_not_found"]);
    expect(skipped.map((p) => p.resourceId).sort()).toEqual([...ids].sort());
  });

  it("a normal create for an available DAK still opens the file and links the DAK", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const id = randomUUID();
    const m = env(COMMANDS.fileCreate, { id, tenantId: TENANT, section: "ADMIN", subject: "From DAK", dept: "ADMIN", priority: "normal", classification: "public", currentWith: ACTOR, inwardId: AVAILABLE, dakNo: "DAK/1" });
    await q.publish(COMMANDS.fileCreate, m);
    await waitProcessed(m.messageId);
    await q.stop();
    expect((await inwardRow(AVAILABLE))?.fileId).toBe(id);
    expect(await filesForInward(AVAILABLE)).toHaveLength(1);
  });
});

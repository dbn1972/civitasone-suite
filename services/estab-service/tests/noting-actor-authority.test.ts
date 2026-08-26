/**
 * Fix — the officer of record in the eOffice noting/custody/DAK trail must
 * always be the authenticated actor, never a client-supplied value.
 *
 * A page-by-page ledger traced a hardcoded phantom officer
 * (00000000-0000-0000-0000-000000000099) all the way back to two real
 * backend gaps in services/estab-service/src/modules/files/:
 *
 *  1. commands.ts#addNoting spread the client-supplied `officerId` /
 *     `officerName` verbatim into the queued notingAdd command, unlike
 *     signNoting (same file) which correctly derives the actor from
 *     ctx.actorId.
 *  2. consumer.ts's fileCreate / inwardOpenFile handlers seeded the file's
 *     opening ("initiate" / "dak_to_file") yellow note's officerId from
 *     `currentWith` (the officer the file is ROUTED to — a client-suppliable
 *     field) instead of the actor who actually created the file.
 *
 * This matters because officerId is not cosmetic: it is the noting's author
 * of record and feeds the tamper-evident hash chain (computeNotingHash) once
 * a note is signed.
 *
 * Suite A (unit) — proves commands.ts itself always publishes the
 * authenticated actor, regardless of what the request body claims. No DB or
 * live queue backend needed: queue.publish is spied and never actually runs.
 *
 * Suite B (integration) — runs the real files consumer against the dev DB
 * via MemoryQueue (mirroring services/estab-service/tests/file-approve-noting-chain.test.ts)
 * to prove the write path itself binds officerId to the authenticated actor,
 * both for the fileCreate opening note and, as defense-in-depth, for a
 * direct notingAdd whose payload disagrees with the envelope's actorId.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { addNoting, createFile } from "../src/modules/files/commands.js";
import { COMMANDS } from "../src/topics.js";

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: "77777777-aaaa-4000-8000-0000000000f1",
    actorId: "00000000-aaaa-4000-8000-0000000000a1",
    actorType: "user",
    roles: ["section_officer"],
    correlationId: "corr-noting-authority",
    ...overrides,
  };
}

describe("commands.ts — officer of record is always ctx.actorId (unit)", () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Intercept the real shared queue singleton (the same one commands.ts
    // imports and calls) so nothing actually gets published/consumed — this
    // isolates the test to "what does commands.ts construct", with no DB.
    publishSpy = vi.spyOn(sharedQueue, "publish").mockResolvedValue(undefined as unknown as void);
  });

  afterEach(() => {
    publishSpy.mockRestore();
  });

  it("addNoting ignores a client-supplied officerId/officerName and records ctx.actorId", async () => {
    const ctx = makeCtx({ actorId: "00000000-aaaa-4000-8000-0000000000a1" });
    const ATTACKER_ID = "99999999-ffff-4000-8000-0000000000ff";

    await addNoting(ctx, "file-1", {
      body: "Recommending approval",
      officerId: ATTACKER_ID, // spoofed identity claim — must be ignored
      officerName: "Spoofed Senior Officer",
      noteType: "yellow",
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [topic, message] = publishSpy.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.notingAdd);
    const payload = (message as { payload: { officerId: string } }).payload;
    expect(payload.officerId).toBe(ctx.actorId);
    expect(payload.officerId).not.toBe(ATTACKER_ID);
  });

  it("addNoting records ctx.actorId even when the client sends no officerId at all", async () => {
    const ctx = makeCtx({ actorId: "00000000-aaaa-4000-8000-0000000000a4" });

    await addNoting(ctx, "file-1", { body: "A note", noteType: "yellow" });

    const [, message] = publishSpy.mock.calls[0]!;
    const payload = (message as { payload: { officerId: string } }).payload;
    expect(payload.officerId).toBe(ctx.actorId);
  });

  it("createFile defaults currentWith to ctx.actorId when the client omits it", async () => {
    const ctx = makeCtx({ actorId: "00000000-aaaa-4000-8000-0000000000a2" });

    await createFile(ctx, {
      subject: "Test file",
      dept: "ADMIN",
      priority: "normal",
      classification: "public",
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [topic, message] = publishSpy.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.fileCreate);
    const payload = (message as { payload: { currentWith: string } }).payload;
    expect(payload.currentWith).toBe(ctx.actorId);
  });

  it("createFile preserves an explicit currentWith (routing to a real colleague still works)", async () => {
    const ctx = makeCtx({ actorId: "00000000-aaaa-4000-8000-0000000000a3" });
    const COLLEAGUE = "00000000-bbbb-4000-8000-0000000000b1";

    await createFile(ctx, {
      subject: "Test file 2",
      dept: "ADMIN",
      priority: "normal",
      classification: "public",
      currentWith: COLLEAGUE,
    });

    const [, message] = publishSpy.mock.calls[0]!;
    const payload = (message as { payload: { currentWith: string } }).payload;
    expect(payload.currentWith).toBe(COLLEAGUE);
  });
});

const TENANT = "77777777-aaaa-4000-8000-0000000000f1";
const CREATOR = "00000000-aaaa-4000-8000-0000000000d1";
const ROUTED_TO = "00000000-bbbb-4000-8000-0000000000d2"; // file routed to a DIFFERENT officer
const ATTACKER_CLAIM = "99999999-ffff-4000-8000-0000000000ff";
const FILE_ID = "33333333-bbbb-4000-8000-0000000000d1";
const NOTE_ID = "44444444-cccc-4000-8000-0000000000d1";
const MSG_FILE_CREATE = "55555555-dddd-4000-8000-0000000000d1";
const MSG_NOTING_ADD = "66666666-eeee-4000-8000-0000000000d1";

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the `createQueue()`
 * factory) does NOT auto-wrap subscribed handlers with `withTenantConsumer`.
 * Mirrors the identical helper in file-approve-noting-chain.test.ts.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function waitForProcessed(messageId: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId))),
    );
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`message ${messageId} was never marked processed`);
}

async function clean(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_FILE_CREATE));
      await tx.delete(processed).where(eq(processed.messageId, MSG_NOTING_ADD));
    }),
  );
}

describe("files consumer — officer of record binds to the authenticated actor (integration)", () => {
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await sqlClient.end();
  });

  it("fileCreate's opening yellow note is authored by the creator, not the officer the file is routed to", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();

    await q.publish(COMMANDS.fileCreate, {
      messageId: MSG_FILE_CREATE, type: COMMANDS.fileCreate,
      tenantId: TENANT, actorId: CREATOR, correlationId: "corr-d1", schemaVersion: "1.0",
      payload: {
        id: FILE_ID, tenantId: TENANT, subject: "Test", dept: "ADMIN",
        priority: "normal", classification: "public",
        currentWith: ROUTED_TO, // file is routed to someone else
        initialNote: "Opening note",
      },
    });
    await waitForProcessed(MSG_FILE_CREATE);
    await q.stop();

    const file = (await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabFiles).where(eq(estabFiles.id, FILE_ID))),
    ))[0];
    expect(file?.currentWith).toBe(ROUTED_TO); // routing itself is untouched by this fix

    const notings = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabNotings).where(eq(estabNotings.fileId, FILE_ID))),
    );
    expect(notings).toHaveLength(1);
    // SECURITY: the opening note's officer of record is the creator, not the
    // (different) officer the file happens to be routed to.
    expect(notings[0]?.officerId).toBe(CREATOR);
    expect(notings[0]?.officerId).not.toBe(ROUTED_TO);
  });

  it("notingAdd binds officerId to the envelope's actorId even if the payload disagrees (defense-in-depth)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();

    // Seed a file directly so notingAdd has somewhere to attach.
    await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.insert(estabFiles).values({
        id: FILE_ID, tenantId: TENANT, fileNo: "EST/2026/D1", subject: "Test",
        dept: "ADMIN", currentWith: CREATOR, status: "active",
        createdBy: CREATOR, updatedBy: CREATOR,
      })),
    );

    await q.publish(COMMANDS.notingAdd, {
      messageId: MSG_NOTING_ADD, type: COMMANDS.notingAdd,
      tenantId: TENANT, actorId: CREATOR, correlationId: "corr-d2", schemaVersion: "1.0",
      payload: {
        id: NOTE_ID, fileId: FILE_ID, tenantId: TENANT, body: "A note",
        officerId: ATTACKER_CLAIM, // even if some payload disagreed with actorId...
        noteType: "yellow",
      },
    });
    await waitForProcessed(MSG_NOTING_ADD);
    await q.stop();

    const noting = (await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabNotings).where(eq(estabNotings.id, NOTE_ID))),
    ))[0];
    // ...the consumer still binds officerId to the envelope's real actor.
    expect(noting?.officerId).toBe(CREATOR);
    expect(noting?.officerId).not.toBe(ATTACKER_CLAIM);
  });
});

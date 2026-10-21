/**
 * Estab files, against a real database (W2 estab rescan, cluster 02).
 *
 *  GAP-ESTAB-DASHBOARD-04  the register list is newest-first and capped AFTER ordering, so the
 *                          dashboard's "Recent files" can never miss the newest file.
 *  GAP-ESTAB-FILES-DETAIL-01  a closed / archived file takes no noting, submission, signing or
 *                          move: the route answers 409 FILE_READ_ONLY and enqueues nothing; the
 *                          consumers refuse it too (and submit no longer flips a closed file back
 *                          to "active").
 *  GAP-ESTAB-DASHBOARD-04 (follow-up)  the register list is cached for 60 s per page size; the
 *                          consumers that add a file or close one drop it, so a new file is first on
 *                          the very next read and a closed file reads as closed.
 *  GAP-ESTAB-FILES-DETAIL-05/06  GET /v1/estab/files/:id carries each note's signedAt, and the real
 *                          payload satisfies the web's EstabFileDetailSchema without losing
 *                          noteType / noteStatus / eSigned / signedAt / movementHistory / dakNo / dueBy.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { EstabFileDetailSchema } from "@civitasone/schemas/web";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { cache, queue as sharedQueue } from "../src/shared/infra.js";
import { estabFiles, estabNotings, estabFileMovements } from "../src/modules/files/schema.js";
import { estabFileRecord } from "../src/modules/records/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { isFileReadOnly } from "../src/modules/files/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "c0ff33aa-0000-4000-8000-0000000c0201";
const OTHER_TENANT = "c0ff33aa-0000-4000-8000-0000000c0202";
const ACTOR = "c0ff33aa-0000-4000-8000-0000000c02a1";
const PEER = "c0ff33aa-0000-4000-8000-0000000c02a2";

const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["estab_officer"], sid: "sess-c02-files" }, SECRET, 3600)}`,
  "x-tenant-id": tenant,
});

/** Mirrors production's createQueue(): every handler runs under the message's tenant GUC. */
function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const env = (type: string, payload: Record<string, unknown>, actor = ACTOR) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: actor, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};

async function waitProcessed(messageId: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId))),
    );
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function wipe(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
        await tx.delete(estabFileMovements).where(eq(estabFileMovements.tenantId, t));
        // a signed note is frozen by a trigger: downgrade before deleting, as the other suites do
        await tx.execute(sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${t}`);
        await tx.delete(estabNotings).where(eq(estabNotings.tenantId, t));
        await tx.delete(estabFileRecord).where(eq(estabFileRecord.tenantId, t));
        await tx.delete(estabFiles).where(eq(estabFiles.tenantId, t));
      }),
    );
  }
}

async function seedFile(opts: { status?: string; createdAgoHours?: number; tenant?: string; fileNo?: string } = {}): Promise<string> {
  const id = randomUUID();
  const tenant = opts.tenant ?? TENANT;
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(estabFiles).values({
        id, tenantId: tenant, fileNo: opts.fileNo ?? `C02/${id.slice(0, 8)}`, subject: `Subject ${id.slice(0, 8)}`,
        dept: "ADMIN", currentWith: ACTOR, status: opts.status ?? "active",
        createdAt: new Date(Date.now() - (opts.createdAgoHours ?? 0) * 3_600_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

async function seedDraftNote(fileId: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(estabNotings).values({
        id, tenantId: TENANT, fileId, seq: 1, officerId: ACTOR, body: "Proposal for sanction.",
        noteType: "yellow", noteStatus: "draft", createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

const fileRow = async (id: string) => (await runWithTenant(TENANT, () =>
  db.transaction((tx) => tx.select().from(estabFiles).where(eq(estabFiles.id, id)))))[0];
const notingRow = async (id: string) => (await runWithTenant(TENANT, () =>
  db.transaction((tx) => tx.select().from(estabNotings).where(eq(estabNotings.id, id)))))[0];
const auditActions = async () => (await runWithTenant(TENANT, () =>
  db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))))
  .map((r) => (r.payload as { action?: string }).action);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
beforeEach(wipe);
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GAP-ESTAB-DASHBOARD-04 — the register list is newest-first, then capped", () => {
  it("returns the newest files in order, not an arbitrary subset, when there are more files than the limit", async () => {
    // Inserted oldest-first and shuffled, so insertion order cannot be mistaken for creation order.
    const ages = [50, 5, 30, 1, 20, 10, 40]; // hours ago
    const idByAge = new Map<number, string>();
    for (const h of ages) idByAge.set(h, await seedFile({ createdAgoHours: h, fileNo: `ORD/${h}` }));
    const res = await app.inject({ method: "GET", url: "/v1/estab/files?limit=3", headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; fileNo: string }>; pagination: { hasMore: boolean } };
    expect(body.data.map((f) => f.fileNo)).toEqual(["ORD/1", "ORD/5", "ORD/10"]);
    expect(body.data[0]?.id).toBe(idByAge.get(1));
    expect(body.pagination.hasMore).toBe(true);
  });

  it("lists every file newest-first when the limit covers them all, and never another tenant's file", async () => {
    await seedFile({ createdAgoHours: 3, fileNo: "ORD/3" });
    await seedFile({ createdAgoHours: 2, fileNo: "ORD/2" });
    await seedFile({ createdAgoHours: 0, fileNo: "ORD/OTHER", tenant: OTHER_TENANT });
    const res = await app.inject({ method: "GET", url: "/v1/estab/files?limit=50", headers: headers() });
    const nos = (res.json() as { data: Array<{ fileNo: string }> }).data.map((f) => f.fileNo);
    expect(nos).toEqual(["ORD/2", "ORD/3"]);
  });
});

describe("GAP-ESTAB-DASHBOARD-04 follow-up — the cached register list is refreshed when a file is created or closed", () => {
  // the in-process cache outlives a test: start each one cold (every cached "file" entry, both tenants)
  beforeEach(async () => {
    for (const t of [TENANT, OTHER_TENANT]) await cache.invalidateResource(t, "file");
  });
  const readList = async (limit: number, tenant = TENANT) => {
    const res = await app.inject({ method: "GET", url: `/v1/estab/files?limit=${limit}`, headers: headers(tenant) });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Array<{ fileNo: string; status: string }> }).data;
  };
  const createCmd = (id: string, fileNo: string) =>
    env(COMMANDS.fileCreate, {
      id, tenantId: TENANT, fileNo, section: "ESTAB-C", subject: `Subject ${fileNo}`, dept: "ESTAB",
      priority: "normal", classification: "public", currentWith: ACTOR,
    });

  it("a file created by the fileCreate consumer is first on the very next read, for every cached page size", async () => {
    await seedFile({ createdAgoHours: 5, fileNo: "CACHE/OLD" });
    // warm the read-through cache for two page sizes
    expect((await readList(50)).map((f) => f.fileNo)).toEqual(["CACHE/OLD"]);
    expect((await readList(10)).map((f) => f.fileNo)).toEqual(["CACHE/OLD"]);

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const m = createCmd(randomUUID(), "CACHE/NEW");
    await q.publish(COMMANDS.fileCreate, m); await waitProcessed(m.messageId);
    await q.stop();

    expect((await readList(50)).map((f) => f.fileNo)).toEqual(["CACHE/NEW", "CACHE/OLD"]);
    expect((await readList(10)).map((f) => f.fileNo)).toEqual(["CACHE/NEW", "CACHE/OLD"]);
  });

  it("a file closed by the fileClose consumer reads as closed on the very next read", async () => {
    const fileId = await seedFile({ status: "active", fileNo: "CACHE/CLOSE" });
    // closure needs a record category (CSMOP/RRS), exactly as in production
    await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.insert(estabFileRecord).values({ tenantId: TENANT, fileId, recordCategory: "B", createdBy: ACTOR })));
    expect((await readList(50)).map((f) => f.status)).toEqual(["active"]);

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const m = env(COMMANDS.fileClose, { fileId, tenantId: TENANT });
    await q.publish(COMMANDS.fileClose, m); await waitProcessed(m.messageId);
    await q.stop();

    expect((await fileRow(fileId))?.status).toBe("closed");
    expect((await readList(50)).map((f) => f.status)).toEqual(["closed"]);
  });

  it("only the writing tenants list is dropped: another tenants cached list is left as it was", async () => {
    await seedFile({ createdAgoHours: 1, fileNo: "CACHE/B-ONE", tenant: OTHER_TENANT });
    expect((await readList(50, OTHER_TENANT)).map((f) => f.fileNo)).toEqual(["CACHE/B-ONE"]);
    // a second file for the other tenant, written straight to the table (no consumer, so no invalidation)
    await seedFile({ createdAgoHours: 0, fileNo: "CACHE/B-TWO", tenant: OTHER_TENANT });

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const m = createCmd(randomUUID(), "CACHE/A-ONE");
    await q.publish(COMMANDS.fileCreate, m); await waitProcessed(m.messageId);
    await q.stop();

    expect((await readList(50)).map((f) => f.fileNo)).toEqual(["CACHE/A-ONE"]);
    // still the cached page: tenant As write did not touch tenant Bs cache entry
    expect((await readList(50, OTHER_TENANT)).map((f) => f.fileNo)).toEqual(["CACHE/B-ONE"]);
  });
});

describe("GAP-ESTAB-FILES-DETAIL-01 — closed / archived files are read-only", () => {
  it("isFileReadOnly covers closed, archived and disposed only", () => {
    for (const s of ["closed", "archived", "disposed"]) expect(isFileReadOnly(s)).toBe(true);
    for (const s of ["draft", "active", "pending"]) expect(isFileReadOnly(s)).toBe(false);
    expect(isFileReadOnly(null)).toBe(false);
    expect(isFileReadOnly(undefined)).toBe(false);
  });

  for (const status of ["closed", "archived"]) {
    it(`the routes answer 409 FILE_READ_ONLY on a ${status} file and enqueue nothing`, async () => {
      const fileId = await seedFile({ status });
      const notingId = await seedDraftNote(fileId);
      const publish = vi.spyOn(sharedQueue, "publish");
      const calls = [
        { method: "POST", url: `/v1/estab/files/${fileId}/notings`, payload: { body: "More to add." } },
        { method: "POST", url: `/v1/estab/files/${fileId}/submit-for-approval`, payload: { notingId } },
        { method: "POST", url: `/v1/estab/files/${fileId}/notings/${notingId}/sign`, payload: {} },
        { method: "PATCH", url: `/v1/estab/files/${fileId}/move`, payload: { toOfficer: PEER } },
      ] as const;
      for (const c of calls) {
        const res = await app.inject({ method: c.method, url: c.url, headers: headers(), payload: c.payload });
        expect(res.statusCode, `${c.method} ${c.url}`).toBe(409);
        expect(res.json().code).toBe("FILE_READ_ONLY");
      }
      expect(publish).not.toHaveBeenCalled();
    });
  }

  it("the same routes still accept an active file (202) and enqueue the command", async () => {
    const fileId = await seedFile({ status: "active" });
    const notingId = await seedDraftNote(fileId);
    const publish = vi.spyOn(sharedQueue, "publish");
    const submit = await app.inject({ method: "POST", url: `/v1/estab/files/${fileId}/submit-for-approval`, headers: headers(), payload: { notingId } });
    expect(submit.statusCode).toBe(202);
    const sign = await app.inject({ method: "POST", url: `/v1/estab/files/${fileId}/notings/${notingId}/sign`, headers: headers(), payload: {} });
    expect(sign.statusCode).toBe(202);
    const topics = publish.mock.calls.map((c) => c[0]);
    expect(topics).toContain(COMMANDS.notingSubmit);
    expect(topics).toContain(COMMANDS.notingSign);
  });

  it("an unknown file id falls through to the consumer no-op, as before (not a 409)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/estab/files/${randomUUID()}/submit-for-approval`, headers: headers(), payload: { notingId: randomUUID() } });
    expect(res.statusCode).toBe(202);
  });

  for (const status of ["closed", "archived"]) {
    it(`the consumers refuse submit and sign on a ${status} file: the note, the file status and the signature chain are untouched, and the refusal is audited`, async () => {
      const fileId = await seedFile({ status });
      const notingId = await seedDraftNote(fileId);
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerFilesConsumers(q);
      await q.start();
      const mSubmit = env(COMMANDS.notingSubmit, { fileId, notingId, tenantId: TENANT });
      await q.publish(COMMANDS.notingSubmit, mSubmit); await waitProcessed(mSubmit.messageId);
      const mSign = env(COMMANDS.notingSign, { fileId, notingId, tenantId: TENANT });
      await q.publish(COMMANDS.notingSign, mSign); await waitProcessed(mSign.messageId);
      await q.stop();

      const note = await notingRow(notingId);
      expect(note?.noteStatus).toBe("draft");
      expect(note?.noteType).toBe("yellow");
      expect(note?.eSigned).toBe(false);
      expect(note?.signedAt).toBeNull();
      // the old submit also did updateFile({status: "active"}), re-opening a closed file
      expect((await fileRow(fileId))?.status).toBe(status);
      const actions = await auditActions();
      expect(actions).toContain("noting_submit_rejected_read_only_file");
      expect(actions).toContain("noting_sign_rejected_read_only_file");
    });
  }

  it("the consumers still submit and sign on an active file", async () => {
    const fileId = await seedFile({ status: "active" });
    const toSubmit = await seedDraftNote(fileId);
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const mSubmit = env(COMMANDS.notingSubmit, { fileId, notingId: toSubmit, tenantId: TENANT });
    await q.publish(COMMANDS.notingSubmit, mSubmit); await waitProcessed(mSubmit.messageId);
    expect((await notingRow(toSubmit))?.noteStatus).toBe("submitted");

    const mSign = env(COMMANDS.notingSign, { fileId, notingId: toSubmit, tenantId: TENANT });
    await q.publish(COMMANDS.notingSign, mSign); await waitProcessed(mSign.messageId);
    await q.stop();
    const signed = await notingRow(toSubmit);
    expect(signed?.noteType).toBe("green");
    expect(signed?.eSigned).toBe(true);
    expect(signed?.signedAt).toBeInstanceOf(Date);
  });
});

describe("GAP-ESTAB-FILES-DETAIL-05/06 — the file detail payload carries signedAt and satisfies the web schema", () => {
  it("sends each note's signedAt (null while unsigned), and the real payload passes EstabFileDetailSchema intact", async () => {
    const fileId = await seedFile({ status: "active" });
    const signedId = await seedDraftNote(fileId);
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFilesConsumers(q);
    await q.start();
    const mSign = env(COMMANDS.notingSign, { fileId, notingId: signedId, tenantId: TENANT });
    await q.publish(COMMANDS.notingSign, mSign); await waitProcessed(mSign.messageId);
    // a later unsigned yellow note
    const draftId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(estabNotings).values({
      id: draftId, tenantId: TENANT, fileId, seq: 2, officerId: ACTOR, body: "Second thoughts.",
      noteType: "yellow", noteStatus: "draft", createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const mMove = env(COMMANDS.fileMove, { fileId, tenantId: TENANT, toOfficer: PEER, remarks: "For comment" });
    await q.publish(COMMANDS.fileMove, mMove); await waitProcessed(mMove.messageId);
    await q.stop();

    const res = await app.inject({ method: "GET", url: `/v1/estab/files/${fileId}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const raw = res.json() as { noteSheets: Array<{ id: string; signedAt: string | null; author: string | null }> };
    const rawSigned = raw.noteSheets.find((n) => n.id === signedId);
    const rawDraft = raw.noteSheets.find((n) => n.id === draftId);
    expect(rawSigned?.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(rawDraft?.signedAt).toBeNull();
    // hrms is not wired in this suite, so officers are unresolved: the schema must take a null author
    expect(rawSigned?.author).toBeNull();

    const parsed = EstabFileDetailSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    const notes = new Map(parsed.data.noteSheets.map((n) => [n.id, n]));
    expect(notes.get(signedId)).toMatchObject({ noteType: "green", noteStatus: "approved", eSigned: true });
    expect(notes.get(signedId)?.signedAt).toBe(rawSigned?.signedAt);
    expect(notes.get(draftId)).toMatchObject({ noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null });
    expect(parsed.data.movementHistory).toHaveLength(1);
    expect(parsed.data.movementHistory[0]).toMatchObject({ toOfficerId: PEER, action: "forward", remarks: "For comment" });
    expect(parsed.data.status).toBe("active");
  });

  it("also passes for a closed file with public classification (values the old schema rejected)", async () => {
    const fileId = await seedFile({ status: "closed" });
    const res = await app.inject({ method: "GET", url: `/v1/estab/files/${fileId}`, headers: headers() });
    const parsed = EstabFileDetailSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("closed");
      expect(parsed.data.classification).toBe("public");
    }
  });
});

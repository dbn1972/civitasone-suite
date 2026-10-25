/**
 * CLOS3-S4-06 -- fileOpenVolume / fileOpenPart allocate volume_no / part_no with an unserialised
 * SELECT MAX()+1 in a READ COMMITTED transaction. Concurrent openings on one root file both read
 * the same max and insert the same number (-> the same derived file_no, a unique violation).
 *
 * Real Postgres, non-superuser role. Handlers are captured from a stub queue and invoked
 * directly so the transactions genuinely overlap.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c1036000-5406-4000-8000-000000000001";
const TENANT_2 = "c1036000-5406-4000-8000-000000000002";
const OFFICER = "c1036000-5406-4000-8000-0000000000a1";
const ROOT = "c1036000-5406-4000-8000-0000000000f1";
const ROOT_B = "c1036000-5406-4000-8000-0000000000f2";
const ROOT_T2 = "c1036000-5406-4000-8000-0000000000f3";
const N = 4;

type Handler = (msg: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
registerFilesConsumers({
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, withTenantConsumer(h as never) as Handler); },
  publish: async () => {},
} as never);

const msg = (tenantId: string, type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId, actorId: OFFICER,
  correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

const openVolume = (tenantId: string, baseFileId: string, id = randomUUID()) =>
  handlers.get(COMMANDS.fileOpenVolume)!(msg(tenantId, COMMANDS.fileOpenVolume, { id, baseFileId, tenantId, currentWith: null }));
const openPart = (tenantId: string, baseFileId: string, id = randomUUID()) =>
  handlers.get(COMMANDS.fileOpenPart)!(msg(tenantId, COMMANDS.fileOpenPart, { id, baseFileId, tenantId, subject: null, currentWith: null }));

const childrenOf = (tenantId: string, rootId: string, type: "volume" | "part") =>
  runWithTenant(tenantId, () => db.transaction((tx) =>
    tx.select().from(estabFiles).where(eq(estabFiles.parentFileId, rootId)),
  )).then((rows) => rows.filter((r) => r.fileType === type));

async function seedRoot(tenantId: string, id: string, fileNo: string) {
  await runWithTenant(tenantId, () => db.transaction((tx) => tx.insert(estabFiles).values({
    id, tenantId, fileNo, subject: "S4-06 root", dept: "GAD", priority: "normal",
    classification: "confidential", currentWith: OFFICER, status: "active",
    createdBy: OFFICER, updatedBy: OFFICER,
  })));
}

async function clean() {
  for (const t of [TENANT, TENANT_2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  await clean();
  await seedRoot(TENANT, ROOT, "EST/2026/S406-A");
  await seedRoot(TENANT, ROOT_B, "EST/2026/S406-B");
  await seedRoot(TENANT_2, ROOT_T2, "EST/2026/S406-A"); // same file_no, other tenant: legal
});
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("CLOS3-S4-06 concurrent volume / part allocation (real DB)", () => {
  it(`${N} concurrent fileOpenVolume on one root all succeed with distinct volume_no and file_no`, async () => {
    const results = await Promise.allSettled(Array.from({ length: N }, () => openVolume(TENANT, ROOT)));
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const vols = await childrenOf(TENANT, ROOT, "volume");
    expect(vols).toHaveLength(N);
    expect(vols.map((v) => v.volumeNo).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(new Set(vols.map((v) => v.fileNo)).size).toBe(N);
  });

  it("opening volumes on a different root, and in a different tenant, is independent (each starts at volume 2)", async () => {
    const results = await Promise.allSettled([openVolume(TENANT, ROOT_B), openVolume(TENANT_2, ROOT_T2)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await childrenOf(TENANT, ROOT_B, "volume")).map((v) => v.volumeNo)).toEqual([2]);
    expect((await childrenOf(TENANT_2, ROOT_T2, "volume")).map((v) => v.volumeNo)).toEqual([2]);
  });
});

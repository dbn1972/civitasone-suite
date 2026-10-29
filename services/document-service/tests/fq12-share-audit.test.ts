/**
 * FQ12-SEC (UAT #123/#124): POST /v1/documents/shares and
 * DELETE /v1/documents/shares/:id wrote no audit event, so access grants and
 * revocations left no trail. Both consumers now enqueue audit.event.record in
 * the write transaction, like every other document-service mutation.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerSharingConsumers } from "../src/modules/sharing/consumer.js";
import { fileShares } from "../src/modules/sharing/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = randomUUID();
const ACTOR = randomUUID();

function auth(): Record<string, string> {
  const jwt = signToken({ sub: ACTOR, tid: T, roles: ["document_user"], sid: "sess-fq12-share" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": T };
}

async function waitFor<V>(fn: () => Promise<V>, ok: (v: V) => boolean, timeoutMs = 5000): Promise<V> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await fn();
  }
  return last;
}

const audits = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages)
  .where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, "audit.event.record")))));

registerSharingConsumers(appQueue);
await appQueue.start();
const app = await buildApp();

afterAll(async () => {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(fileShares).where(eq(fileShares.tenantId, T));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
  }));
  await app.close();
  await sqlClient.end();
});

describe("document share create / revoke emit audit events", () => {
  it("create then revoke each record an audit event with actor, tenant, document, target and action", async () => {
    const fileId = randomUUID();
    const sharedWith = randomUUID();

    const created = await app.inject({ method: "POST", url: "/v1/documents/shares", headers: auth(), payload: { fileId, sharedWith, permission: "read" } });
    expect(created.statusCode).toBe(202);
    const shareId = (created.json() as { id: string }).id;

    const afterCreate = await waitFor(audits, (r) => r.some((m) => (m.payload as { action?: string }).action === "share_create"));
    const c = afterCreate.find((m) => (m.payload as { action?: string }).action === "share_create")!;
    expect(c.topic).toBe("audit.event.record");
    expect(c.tenantId).toBe(T);
    expect(c.actorId).toBe(ACTOR);
    expect(c.payload).toMatchObject({
      service: "document", action: "share_create", resourceType: "file_share", resourceId: shareId, outcome: "success",
      details: { documentId: fileId, sharedWith, permission: "read" },
    });

    const revoked = await app.inject({ method: "DELETE", url: `/v1/documents/shares/${shareId}`, headers: auth() });
    expect(revoked.statusCode).toBe(202);
    const afterRevoke = await waitFor(audits, (r) => r.some((m) => (m.payload as { action?: string }).action === "share_revoke"));
    const r = afterRevoke.find((m) => (m.payload as { action?: string }).action === "share_revoke")!;
    expect(r.tenantId).toBe(T);
    expect(r.actorId).toBe(ACTOR);
    expect(r.payload).toMatchObject({
      service: "document", action: "share_revoke", resourceType: "file_share", resourceId: shareId, outcome: "success",
      details: { documentId: fileId, sharedWith, permission: "read" },
    });

    const [row] = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(fileShares).where(eq(fileShares.id, shareId))));
    expect(row!.revokedAt).not.toBeNull();
  });

  it("revoking an unknown share is audited as a failure, not silent", async () => {
    const ghost = randomUUID();
    const res = await app.inject({ method: "DELETE", url: `/v1/documents/shares/${ghost}`, headers: auth() });
    expect(res.statusCode).toBe(202);
    const rows = await waitFor(audits, (rs) => rs.some((m) => (m.payload as { resourceId?: string }).resourceId === ghost));
    const a = rows.find((m) => (m.payload as { resourceId?: string }).resourceId === ghost)!;
    expect(a.payload).toMatchObject({ action: "share_revoke", outcome: "failure", details: { documentId: null, sharedWith: null } });
  });
});

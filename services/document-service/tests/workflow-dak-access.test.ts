/**
 * SECURITY: dak ownership scoping. A document_user may only list/read/forward/acknowledge daks they
 * created or hold (assignee); document_admin / super_admin keep tenant-wide access.
 * DB-backed, same harness as comp-007-workflow-smoke.test.ts.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerWorkflowConsumers } from "../src/modules/workflow/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function as(roles: string[], tid: string, sub: string): Record<string, string> {
  const jwt = signToken({ sub, tid, roles, sid: "sess-dak-access" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerWorkflowConsumers(appQueue);
await appQueue.start();
const app = await buildApp();
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function mkDak(tid: string, creator: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/documents/daks", headers: as(["document_user"], tid, creator), payload: { subject: "Confidential file", body: "secret body", ...extra } });
  await appQueue.drain();
  return res.json().id as string;
}

describe("dak access scoping", () => {
  it("a non-owner document_user cannot list, read, forward, acknowledge or annotate someone else's dak", async () => {
    const tid = randomUUID(); const owner = randomUUID(); const other = randomUUID();
    const id = await mkDak(tid, owner);
    const h = as(["document_user"], tid, other);

    const list = await app.inject({ method: "GET", url: "/v1/documents/daks", headers: h });
    expect(list.json().data.map((d: { id: string }) => d.id)).not.toContain(id);

    expect((await app.inject({ method: "GET", url: `/v1/documents/daks/${id}`, headers: h })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/documents/daks/${id}/notings`, headers: h })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/notings`, headers: h, payload: { body: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/forward`, headers: h, payload: { assignedTo: other } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/acknowledge`, headers: h })).statusCode).toBe(404);

    const summary = await app.inject({ method: "GET", url: "/v1/documents/inbox/summary", headers: h });
    expect(summary.json().pendingCount).toBe(0);
  });

  it("the creator can read; after forwarding, the assignee holds it and the creator can no longer forward/acknowledge", async () => {
    const tid = randomUUID(); const owner = randomUUID(); const assignee = randomUUID();
    const id = await mkDak(tid, owner);
    const fwd = await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/forward`, headers: as(["document_user"], tid, owner), payload: { assignedTo: assignee } });
    expect(fwd.statusCode).toBe(202);
    await appQueue.drain();

    const a = as(["document_user"], tid, assignee);
    expect((await app.inject({ method: "GET", url: `/v1/documents/daks/${id}`, headers: a })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/documents/daks/${id}`, headers: as(["document_user"], tid, owner) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/acknowledge`, headers: as(["document_user"], tid, owner) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/acknowledge`, headers: a })).statusCode).toBe(202);
  });

  it("document_admin and super_admin keep tenant-wide access; other tenants stay isolated", async () => {
    const tid = randomUUID(); const owner = randomUUID();
    const id = await mkDak(tid, owner);
    for (const role of ["document_admin", "super_admin"]) {
      const h = as([role], tid, randomUUID());
      const list = await app.inject({ method: "GET", url: "/v1/documents/daks", headers: h });
      expect(list.json().data.map((d: { id: string }) => d.id)).toContain(id);
      expect((await app.inject({ method: "GET", url: `/v1/documents/daks/${id}`, headers: h })).statusCode).toBe(200);
    }
    const otherTenantAdmin = as(["document_admin"], randomUUID(), randomUUID());
    expect((await app.inject({ method: "GET", url: `/v1/documents/daks/${id}`, headers: otherTenantAdmin })).statusCode).toBe(404);
  });
});

describe("file create storageKey linkage", () => {
  it("accepts a key from the caller's own presign prefix and rejects foreign/tampered keys", async () => {
    const tid = randomUUID(); const me = randomUUID();
    const h = as(["document_user"], tid, me);
    const own = `uploads/${tid}/document/${me}/${randomUUID()}.pdf`;
    const ok = await app.inject({ method: "POST", url: "/v1/documents/files", headers: h, payload: { name: "a.pdf", storageKey: own } });
    expect(ok.statusCode).toBe(202);
    await appQueue.drain();

    for (const bad of [
      `uploads/${randomUUID()}/document/${me}/x.pdf`,            // another tenant
      `uploads/${tid}/document/${randomUUID()}/x.pdf`,           // another uploader
      `uploads/${tid}/document/${me}/../${randomUUID()}/x.pdf`,  // traversal
    ]) {
      const res = await app.inject({ method: "POST", url: "/v1/documents/files", headers: h, payload: { name: "a.pdf", storageKey: bad } });
      expect(res.statusCode).toBe(400);
    }
  });
});

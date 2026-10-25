/**
 * SECURITY: dak ownership scoping. A document_user may only list/read/forward/acknowledge daks they
 * created or hold (assignee); document_admin / super_admin keep tenant-wide access.
 * DB-backed, same harness as comp-007-workflow-smoke.test.ts.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerWorkflowConsumers } from "../src/modules/workflow/consumer.js";
import * as commands from "../src/modules/workflow/commands.js";
import type { RequestContext } from "@civitasone/types";
import { auditsOf } from "./bulk-scan-review-helpers.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function as(roles: string[], tid: string, sub: string): Record<string, string> {
  const jwt = signToken({ sub, tid, roles, sid: "sess-dak-access" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerWorkflowConsumers(appQueue);
await appQueue.start();
const app = await buildApp();
afterAll(async () => { await app.close(); await sqlClient.end(); });

/** Minimal context for publishing a command straight to the queue, bypassing the route-level checks. */
const ctxFor = (tenantId: string, actorId: string): RequestContext => ({ tenantId, actorId, correlationId: randomUUID() } as unknown as RequestContext);

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

describe("approval decide scoping (segregation of duties)", () => {
  async function submit(tid: string, submitter: string, dakId: string): Promise<string> {
    const res = await app.inject({ method: "POST", url: `/v1/documents/daks/${dakId}/approval`, headers: as(["document_user"], tid, submitter) });
    expect(res.statusCode).toBe(202);
    await appQueue.drain();
    return res.json().id as string;
  }
  const decide = (tid: string, sub: string, roles: string[], approvalId: string, decision = "approved") =>
    app.inject({ method: "POST", url: `/v1/documents/approvals/${approvalId}/decide`, headers: as(roles, tid, sub), payload: { decision } });
  async function statusOf(tid: string, approvalId: string): Promise<string> {
    const rows = await withRawTenantGuc(sqlClient, tid, (tx) => tx`select status from document.approvals where tenant_id = ${tid} and id = ${approvalId}`);
    return rows[0]?.status as string;
  }

  it("blocks an unrelated document_user, the submitter (route and consumer), and other tenants; allows the holder and admins", async () => {
    const tid = randomUUID(); const owner = randomUUID(); const approver = randomUUID(); const stranger = randomUUID();
    const dakId = await mkDak(tid, owner, { assignedTo: approver });
    const approvalId = await submit(tid, owner, dakId);

    // Unrelated user: not the holder -> 404, nothing changes.
    expect((await decide(tid, stranger, ["document_user"], approvalId)).statusCode).toBe(404);
    // Another tenant's admin cannot see it either.
    expect((await decide(randomUUID(), randomUUID(), ["document_admin"], approvalId)).statusCode).toBe(404);
    // Submitter may not decide their own approval, even as admin.
    expect((await decide(tid, owner, ["document_user"], approvalId)).statusCode).toBe(404); // creator is not the holder once assigned
    expect((await decide(tid, owner, ["document_admin"], approvalId)).statusCode).toBe(403);
    await appQueue.drain();
    expect(await statusOf(tid, approvalId)).toBe("pending");

    // Consumer-side guard: a self-approval command published directly (bypassing the route) is dropped.
    await commands.decideApproval(ctxFor(tid, owner), approvalId, "approved", null, true);
    // ...and so is one from a non-holder who claims no admin.
    await commands.decideApproval(ctxFor(tid, stranger), approvalId, "approved", null, false);
    await appQueue.drain();
    expect(await statusOf(tid, approvalId)).toBe("pending");
    // A rejected command is audited as denied, not dropped silently.
    const deniedDecides = (await auditsOf(tid, "decide")).filter((a) => a.payload.outcome === "denied" && a.payload.resourceId === approvalId);
    expect(deniedDecides.map((a) => a.actorId).sort()).toEqual([owner, stranger].sort());

    // The actual holder decides.
    expect((await decide(tid, approver, ["document_user"], approvalId)).statusCode).toBe(202);
    await appQueue.drain();
    expect(await statusOf(tid, approvalId)).toBe("approved");

    // Already decided: 409 from the route, and a replayed command cannot overwrite it.
    expect((await decide(tid, randomUUID(), ["document_admin"], approvalId, "rejected")).statusCode).toBe(409);
    await commands.decideApproval(ctxFor(tid, randomUUID()), approvalId, "rejected", null, true);
    await appQueue.drain();
    expect(await statusOf(tid, approvalId)).toBe("approved");
  });

  it("an admin who did not submit may decide", async () => {
    const tid = randomUUID(); const owner = randomUUID();
    const dakId = await mkDak(tid, owner);
    const approvalId = await submit(tid, owner, dakId);
    expect((await decide(tid, randomUUID(), ["document_admin"], approvalId, "returned")).statusCode).toBe(202);
    await appQueue.drain();
    expect(await statusOf(tid, approvalId)).toBe("returned");
  });
});

describe("consumer re-checks the current holder", () => {
  it("drops forward/acknowledge commands from a stale holder", async () => {
    const tid = randomUUID(); const owner = randomUUID(); const assignee = randomUUID(); const third = randomUUID();
    const id = await mkDak(tid, owner);
    expect((await app.inject({ method: "POST", url: `/v1/documents/daks/${id}/forward`, headers: as(["document_user"], tid, owner), payload: { assignedTo: assignee } })).statusCode).toBe(202);
    await appQueue.drain();

    // The owner passed the route check earlier, but is no longer the holder when the command is consumed.
    await commands.forwardDak(ctxFor(tid, owner), id, third, false);
    await commands.acknowledgeDak(ctxFor(tid, owner), id, false);
    await appQueue.drain();
    const [row] = await withRawTenantGuc(sqlClient, tid, (tx) => tx`select assigned_to, status from document.daks where tenant_id = ${tid} and id = ${id}`);
    expect(row.assigned_to).toBe(assignee);
    expect(row.status).toBe("forwarded");
    // Both rejected commands leave a denied audit event.
    for (const action of ["forward", "acknowledge"]) {
      const denied = (await auditsOf(tid, action)).filter((a) => a.payload.outcome === "denied" && a.payload.resourceId === id && a.actorId === owner);
      expect(denied).toHaveLength(1);
    }

    // The current holder's command still goes through.
    await commands.acknowledgeDak(ctxFor(tid, assignee), id, false);
    await appQueue.drain();
    const [after] = await withRawTenantGuc(sqlClient, tid, (tx) => tx`select status from document.daks where tenant_id = ${tid} and id = ${id}`);
    expect(after.status).toBe("acknowledged");
  });
});

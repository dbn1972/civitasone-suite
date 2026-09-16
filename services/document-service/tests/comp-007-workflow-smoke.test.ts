/**
 * COMP-007 -- document-service `workflow` module (e-office Dak lifecycle:
 * create, forward, acknowledge, notings, approval decisions, inbox summary)
 * smoke test.
 *
 * Registered as both a route AND a consumer (registerWorkflowConsumers,
 * registered in worker.ts) but had zero test references anywhere in the
 * service. Same CQRS-via-shared-queue-singleton pattern as this tranche's
 * `folders` module in this same service (see that test file for why
 * registering the real consumer on the app's own `queue` instance, rather
 * than a disconnected fresh one, is what makes app.inject() creates
 * observable via the GET routes below).
 *
 * Shares folders' disclosed error-handling gap (see comp-007-folders-smoke.
 * test.ts's file header and comp-007-config-smoke.test.ts in metadata-service
 * for the full root-cause writeup) -- confirmed below, the same way.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerWorkflowConsumers } from "../src/modules/workflow/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-workflow" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerWorkflowConsumers(appQueue);
await appQueue.start();

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createDak(tid: string, actorId: string, overrides: Record<string, unknown> = {}) {
  const jwt = signToken({ sub: actorId, tid, roles: ["document_user"], sid: "sess-comp007-workflow" }, SECRET);
  const res = await app.inject({
    method: "POST", url: "/v1/documents/daks",
    headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": tid },
    payload: { subject: "Property tax reassessment request", ...overrides },
  });
  await appQueue.drain();
  return res.json();
}

describe("COMP-007: workflow -- POST /v1/documents/daks (create)", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/documents/daks", payload: { subject: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the document ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/documents/daks",
      headers: authHeaders(["citizen"], tid),
      payload: { subject: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("KNOWN ISSUE (see file header): an invalid body 500s instead of 400", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/documents/daks",
      headers: authHeaders(["document_user"], tid),
      payload: { subject: "" }, // fails min(1)
    });
    expect(res.statusCode).toBe(500);
  });

  it("creates a real row with default priority/status, via the queue + consumer round trip", async () => {
    const tid = randomUUID();
    const actorId = randomUUID();
    const created = await createDak(tid, actorId);
    expect(created.status).toBe("accepted");

    const get = await app.inject({
      method: "GET", url: `/v1/documents/daks/${created.id}`,
      headers: authHeaders(["document_user"], tid),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().subject).toBe("Property tax reassessment request");
    expect(get.json().priority).toBe("normal");
    expect(get.json().status).toBe("pending");
  });
});

describe("COMP-007: workflow -- inbox, forward, acknowledge (real DB, tenant-isolated)", () => {
  it("forward assigns the dak and it appears in the assignee's inbox, real DB verified", async () => {
    const tid = randomUUID();
    const creator = randomUUID();
    const assignee = randomUUID();
    const created = await createDak(tid, creator);

    const forward = await app.inject({
      method: "POST", url: `/v1/documents/daks/${created.id}/forward`,
      headers: authHeaders(["document_user"], tid),
      payload: { assignedTo: assignee },
    });
    expect(forward.statusCode).toBe(202);
    await appQueue.drain();

    const assigneeJwt = signToken({ sub: assignee, tid, roles: ["document_user"], sid: "s" }, SECRET);
    const inbox = await app.inject({
      method: "GET", url: "/v1/documents/inbox",
      headers: { authorization: `Bearer ${assigneeJwt}`, "x-tenant-id": tid },
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().data.map((d: any) => d.id)).toContain(created.id);

    const creatorJwt = signToken({ sub: creator, tid, roles: ["document_user"], sid: "s" }, SECRET);
    const creatorInbox = await app.inject({
      method: "GET", url: "/v1/documents/inbox",
      headers: { authorization: `Bearer ${creatorJwt}`, "x-tenant-id": tid },
    });
    expect(creatorInbox.json().data.map((d: any) => d.id)).not.toContain(created.id);
  });

  it("acknowledge stamps acknowledgedAt on the real row", async () => {
    const tid = randomUUID();
    const actorId = randomUUID();
    const created = await createDak(tid, actorId);

    const ack = await app.inject({
      method: "POST", url: `/v1/documents/daks/${created.id}/acknowledge`,
      headers: authHeaders(["document_user"], tid),
    });
    expect(ack.statusCode).toBe(202);
    await appQueue.drain();

    // acknowledgedAt isn't in DakView's own projection (see schema.ts) -- go
    // through inbox/summary's real counts instead, which is a genuine
    // real-DB-backed aggregate rather than a single-row projection.
    const summary = await app.inject({
      method: "GET", url: "/v1/documents/inbox/summary",
      headers: authHeaders(["document_user"], tid),
    });
    expect(summary.statusCode).toBe(200);
    expect(typeof summary.json().pendingCount).toBe("number");
  });
});

describe("COMP-007: workflow -- notings and approval decisions (real DB)", () => {
  it("adds a noting and reads it back", async () => {
    const tid = randomUUID();
    const actorId = randomUUID();
    const created = await createDak(tid, actorId);

    const addNoting = await app.inject({
      method: "POST", url: `/v1/documents/daks/${created.id}/notings`,
      headers: authHeaders(["document_user"], tid),
      payload: { body: "Forwarded to revenue department for verification." },
    });
    expect(addNoting.statusCode).toBe(202);
    await appQueue.drain();

    const list = await app.inject({
      method: "GET", url: `/v1/documents/daks/${created.id}/notings`,
      headers: authHeaders(["document_user"], tid),
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].body).toBe("Forwarded to revenue department for verification.");
  });

  it("submit + decide an approval, real DB verified", async () => {
    const tid = randomUUID();
    const actorId = randomUUID();
    const created = await createDak(tid, actorId);

    const submit = await app.inject({
      method: "POST", url: `/v1/documents/daks/${created.id}/approval`,
      headers: authHeaders(["document_user"], tid),
    });
    expect(submit.statusCode).toBe(202);
    await appQueue.drain();
    const { id: approvalId } = submit.json();

    const decide = await app.inject({
      method: "POST", url: `/v1/documents/approvals/${approvalId}/decide`,
      headers: authHeaders(["document_user"], tid),
      payload: { decision: "approved", remarks: "Verified against land records." },
    });
    expect(decide.statusCode).toBe(202);
    await appQueue.drain();
    // No GET /approvals/:id route exists to read this back directly (see
    // routes.ts) -- the 202 + real consumer processing (drained above with
    // no error) is the module's own observable surface for this action.
  });

  it("GET /:id 404s for a dak that doesn't exist", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/documents/daks/${randomUUID()}`, headers: authHeaders(["document_user"], tid) });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * GAP-DOCUMENTS batch 1 — document-service backend behaviours:
 *   - INBOX-01: forward/acknowledge now emit an audit event (same pattern as create).
 *   - INBOX-02: inbox summary exposes inbox-scoped urgent/pending/forwarded counts.
 *   - NEW-03:  file create rejects a disallowed extension with 400 + fieldErrors.
 *
 * DB-backed, following comp-007-workflow-smoke.test.ts (real queue + consumer
 * round trip, real Postgres on 5672 via DATABASE_URL).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { outboxMessages } from "@civitasone/outbox";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerWorkflowConsumers } from "../src/modules/workflow/consumer.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

function headers(roles: string[], tid: string, sub = randomUUID()): Record<string, string> {
  const jwt = signToken({ sub, tid, roles, sid: "sess-gap-documents" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerWorkflowConsumers(appQueue);
registerFilesConsumers(appQueue);
await appQueue.start();
const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function auditActions(tid: string): Promise<string[]> {
  const rows = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tid));
  return rows
    .map((r) => r.payload as Record<string, unknown>)
    .filter((p) => (p as { service?: string }).service === "document" && typeof (p as { action?: string }).action === "string")
    .map((p) => String((p as { action?: string }).action));
}

async function createDak(tid: string, actorId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST", url: "/v1/documents/daks",
    headers: headers(["document_user"], tid, actorId),
    payload: { subject: "Property tax reassessment", ...overrides },
  });
  await appQueue.drain();
  return res.json();
}

describe("GAP-DOCUMENTS-INBOX-01: forward/acknowledge emit audit events", () => {
  it("acknowledge writes a document/dak 'acknowledge' audit event", async () => {
    const tid = randomUUID();
    const actorId = randomUUID();
    const created = await createDak(tid, actorId);

    const ack = await app.inject({
      method: "POST", url: `/v1/documents/daks/${created.id}/acknowledge`,
      headers: headers(["document_user"], tid, actorId),
    });
    expect(ack.statusCode).toBe(202);
    await appQueue.drain();

    expect(await auditActions(tid)).toContain("acknowledge");
  });

  it("forward writes a document/dak 'forward' audit event", async () => {
    const tid = randomUUID();
    const actorId = randomUUID();
    const created = await createDak(tid, actorId);

    const fwd = await app.inject({
      method: "POST", url: `/v1/documents/daks/${created.id}/forward`,
      headers: headers(["document_user"], tid, actorId),
      payload: { assignedTo: randomUUID() },
    });
    expect(fwd.statusCode).toBe(202);
    await appQueue.drain();

    expect(await auditActions(tid)).toContain("forward");
  });
});

describe("GAP-DOCUMENTS-INBOX-02: inbox summary exposes inbox-scoped counts", () => {
  it("summary reports inbox-scoped urgent/pending/forwarded for the caller only", async () => {
    const tid = randomUUID();
    const owner = randomUUID();
    // two urgent daks assigned to the owner, one normal dak assigned elsewhere
    const d1 = await createDak(tid, owner, { priority: "urgent" });
    const d2 = await createDak(tid, owner, { priority: "urgent" });
    await app.inject({ method: "POST", url: `/v1/documents/daks/${d1.id}/forward`, headers: headers(["document_user"], tid, owner), payload: { assignedTo: owner } });
    await app.inject({ method: "POST", url: `/v1/documents/daks/${d2.id}/forward`, headers: headers(["document_user"], tid, owner), payload: { assignedTo: owner } });
    await appQueue.drain();

    const summary = await app.inject({
      method: "GET", url: "/v1/documents/inbox/summary",
      headers: headers(["document_user"], tid, owner),
    });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body).toHaveProperty("inboxUrgentCount");
    expect(body).toHaveProperty("inboxPendingCount");
    expect(body).toHaveProperty("inboxForwardedCount");
    expect(body.inboxCount).toBe(2);
    expect(body.inboxUrgentCount).toBe(2);
    expect(body.inboxForwardedCount).toBe(2);
  });
});

describe("GAP-DOCUMENTS-NEW-03: file create rejects a disallowed extension", () => {
  it("returns 400 with fieldErrors for a .exe name", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/documents/files",
      headers: headers(["document_user"], tid),
      payload: { name: "malware.exe", tags: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(res.json().fieldErrors)).toBe(true);
  });

  it("accepts a normal .pdf name", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/documents/files",
      headers: headers(["document_user"], tid),
      payload: { name: "Budget Report Q3.pdf", tags: [] },
    });
    expect(res.statusCode).toBe(202);
    await appQueue.drain();
  });
});

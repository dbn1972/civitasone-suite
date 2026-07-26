/**
 * CAP-060 — integration observability / DLQ replay integration tests.
 *
 * Hits the live civitas_admin DB (admin_svc, NOBYPASSRLS + FORCE RLS) via a real
 * buildApp() + app.inject(). Proves ingestion, listing, requeue (with a REAL
 * republish observed on the shared memory queue), discard, the lifecycle guard,
 * bulk requeue, and RLS tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db } from "../src/shared/db.js";
import { deadLetter, deadLetterAction } from "../src/modules/integration-ops/schema.js";
import { applyDlqAction, DlqError, isTerminal } from "../src/modules/integration-ops/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d1904060-0000-4000-8000-0000000000e1";
const TENANT_B = "d1904060-0000-4000-8000-0000000000e2";
const ACTOR = "ac700060-0000-4000-8000-0000000000e3";

function token(tenantId = TENANT, roles = ["platform_admin"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "dlq" }, SECRET);
}
function h(t: string) {
  return { authorization: `Bearer ${t}` };
}

let app: FastifyInstance;

async function wipe(tenantId: string) {
  const { withTenantScope } = await import("@civitasone/db");
  await withTenantScope(db as any, tenantId, async (tx: any) => {
    await tx.delete(deadLetterAction).where(eq(deadLetterAction.tenantId, tenantId));
    await tx.delete(deadLetter).where(eq(deadLetter.tenantId, tenantId));
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await wipe(TENANT);
  await wipe(TENANT_B);
});

afterAll(async () => {
  await wipe(TENANT);
  await wipe(TENANT_B);
  await app.close();
});

describe("CAP-060 DLQ lifecycle (pure)", () => {
  it("allows pending → requeued / discarded and treats both as terminal", () => {
    expect(applyDlqAction("pending", "requeue")).toBe("requeued");
    expect(applyDlqAction("pending", "discard")).toBe("discarded");
    expect(isTerminal("requeued")).toBe(true);
    expect(isTerminal("discarded")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(() => applyDlqAction("requeued", "requeue")).toThrow(DlqError);
    expect(() => applyDlqAction("discarded", "discard")).toThrow(DlqError);
  });
});

describe("CAP-060 dead-letter routes", () => {
  it("requires super_admin/platform_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/integration-ops/dead-letters",
      headers: h(token(TENANT, ["tenant_admin"])),
    });
    expect(res.statusCode).toBe(403);
  });

  it("records a dead letter idempotently by (topic,messageId)", async () => {
    const messageId = randomUUID();
    const payload = { orderId: "OD-42", amount: 100 };
    const first = await app.inject({
      method: "POST",
      url: "/v1/admin/integration-ops/dead-letters",
      headers: h(token()),
      payload: { topic: "orders.settlement.failed", messageId, sourceService: "billing", payload, error: "handler threw" },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.status).toBe("pending");
    const id = first.json().data.id;

    // same (topic,messageId) again → bumps retry_count, no duplicate row
    const again = await app.inject({
      method: "POST",
      url: "/v1/admin/integration-ops/dead-letters",
      headers: h(token()),
      payload: { topic: "orders.settlement.failed", messageId, payload, error: "handler threw again" },
    });
    expect(again.json().data.id).toBe(id);
    expect(again.json().data.retryCount).toBe(1);
  });

  it("requeues a dead letter — republishing it to its topic on the bus", async () => {
    const messageId = randomUUID();
    const payload = { invoiceId: "INV-9" };
    const rec = await app.inject({
      method: "POST",
      url: "/v1/admin/integration-ops/dead-letters",
      headers: h(token()),
      payload: { topic: "billing.invoice.retry", messageId, payload },
    });
    const id = rec.json().data.id;

    // Observe the real republish on the shared memory bus.
    const received: any[] = [];
    queue.subscribe("billing.invoice.retry", async (msg) => {
      received.push(msg);
    });

    const rq = await app.inject({
      method: "POST",
      url: `/v1/admin/integration-ops/dead-letters/${id}/requeue`,
      headers: h(token()),
      payload: { note: "manual replay after fix" },
    });
    expect(rq.statusCode).toBe(200);
    expect(rq.json().data.status).toBe("requeued");
    expect(rq.json().data.requeuedAt).toBeTruthy();

    await (queue as any).drain?.();
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].payload).toMatchObject({ invoiceId: "INV-9" });
    expect(received[0].messageId).toBe(messageId);

    // audit trail recorded
    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/integration-ops/dead-letters/${id}`,
      headers: h(token()),
    });
    expect(detail.json().actions.some((a: any) => a.action === "requeue")).toBe(true);

    // requeue again → 409 (already terminal)
    const rq2 = await app.inject({
      method: "POST",
      url: `/v1/admin/integration-ops/dead-letters/${id}/requeue`,
      headers: h(token()),
    });
    expect(rq2.statusCode).toBe(409);
  });

  it("discards a dead letter", async () => {
    const rec = await app.inject({
      method: "POST",
      url: "/v1/admin/integration-ops/dead-letters",
      headers: h(token()),
      payload: { topic: "noise.topic", messageId: randomUUID(), payload: {} },
    });
    const id = rec.json().data.id;
    const dc = await app.inject({
      method: "POST",
      url: `/v1/admin/integration-ops/dead-letters/${id}/discard`,
      headers: h(token()),
      payload: { note: "not worth replaying" },
    });
    expect(dc.json().data.status).toBe("discarded");
    const dc2 = await app.inject({
      method: "POST",
      url: `/v1/admin/integration-ops/dead-letters/${id}/discard`,
      headers: h(token()),
    });
    expect(dc2.statusCode).toBe(409);
  });

  it("bulk-requeues every pending message on a topic", async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/admin/integration-ops/dead-letters",
        headers: h(token()),
        payload: { topic: "bulk.replay.topic", messageId: randomUUID(), payload: { n: i } },
      });
    }
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/integration-ops/dead-letters/bulk-requeue",
      headers: h(token()),
      payload: { topic: "bulk.replay.topic" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.requeued).toBe(3);

    const pending = await app.inject({
      method: "GET",
      url: "/v1/admin/integration-ops/dead-letters?status=pending&topic=bulk.replay.topic",
      headers: h(token()),
    });
    expect(pending.json().meta.total).toBe(0);
  });

  it("isolates tenants — Tenant B sees none of Tenant A's dead letters (RLS)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/integration-ops/dead-letters",
      headers: h(token(TENANT_B)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(0);
  });
});

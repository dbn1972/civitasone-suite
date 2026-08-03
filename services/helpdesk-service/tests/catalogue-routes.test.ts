/**
 * Service Catalogue (SVC-129) — HTTP integration tests (app.inject).
 *
 * CQRS: mutations return 202; MemoryQueue + catalogue consumer wired via infra mock
 * so writes persist before assertions.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import type { Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import {
  catalogueOfferings,
  catalogueOlas,
  serviceRequests,
  requestApprovals,
  requestStageEvents,
} from "../src/modules/catalogue/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";

vi.mock("../src/shared/infra.js", async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  const { withTenantConsumer } = await import("@civitasone/db");
  const { registerCatalogueConsumers } = await import("../src/modules/catalogue/consumer.js");
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  registerCatalogueConsumers(q);
  return {
    queue: q,
    cache: {
      invalidate: vi.fn(),
      makeKey: (...parts: string[]) => parts.join(":"),
      getOrLoad: vi.fn(),
      put: vi.fn(),
      invalidateResource: vi.fn(),
      listOrLoad: vi.fn(),
    },
  };
});

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000ca01";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000cb02";
const ADMIN_A = "aaaaaaaa-0000-4000-8000-0000000ada01";
const ADMIN_B = "aaaaaaaa-0000-4000-8000-0000000ada02";
const USER_A = "aaaaaaaa-0000-4000-8000-00000000e501";
const { outboxMessages } = outboxSchema;
const TENANTS = [TENANT_A, TENANT_B];

function token(tid: string, sub: string, roles: string[]) {
  return signToken({ sub, tid, roles, sid: "sess-cat" }, SECRET, 3600);
}
const adminA = () => token(TENANT_A, ADMIN_A, ["helpdesk_admin"]);
const adminB = () => token(TENANT_B, ADMIN_B, ["helpdesk_admin"]);
const adminB_A = () => token(TENANT_A, ADMIN_B, ["helpdesk_admin"]); // 2nd admin in tenant A (checker)
const userA = () => token(TENANT_A, USER_A, ["helpdesk_user"]);
const citizenA = () => token(TENANT_A, USER_A, ["citizen"]);

async function cleanup() {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(requestStageEvents).where(eq(requestStageEvents.tenantId, t));
        await tx.delete(requestApprovals).where(eq(requestApprovals.tenantId, t));
        await tx.delete(serviceRequests).where(eq(serviceRequests.tenantId, t));
        await tx.delete(catalogueOlas).where(eq(catalogueOlas.tenantId, t));
        await tx.delete(catalogueOfferings).where(eq(catalogueOfferings.tenantId, t));
        await tx.delete(tickets).where(eq(tickets.tenantId, t));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      }),
    );
  }
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await cleanup(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

async function post(url: string, tok: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, payload: payload as object });
}
async function patch(url: string, tok: string, payload: unknown) {
  return app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, payload: payload as object });
}
async function get(url: string, tok: string) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok}` } });
}

async function flush() {
  await new Promise((r) => setTimeout(r, 250));
}

/** Create an offering and return its id (202 → consumer flush). */
async function createOffering(tok: string, over: Record<string, unknown> = {}) {
  const res = await post("/v1/helpdesk/catalogue/offerings", tok, {
    name: `Offering ${randomUUID()}`,
    category: "access",
    approvalRequired: false,
    fulfilmentStages: [
      { key: "triage", name: "Triage" },
      { key: "provision", name: "Provision" },
      { key: "verify", name: "Verify" },
    ],
    requestFormSchema: [{ key: "reason", label: "Reason", type: "text", required: true }],
    defaultPriority: "Medium",
    ...over,
  });
  if (res.statusCode === 202) {
    await flush();
    const body = res.json();
    return { ...res, json: () => ({ data: { id: body.id as string } }) };
  }
  return res;
}

describe("catalogue offerings — management + browse", () => {
  it("admin creates an offering (202), user can browse + read detail", async () => {
    const c = await createOffering(adminA());
    expect(c.statusCode).toBe(202);
    const id = c.json().data.id as string;

    const list = await get("/v1/helpdesk/catalogue/offerings", userA());
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((o: { id: string }) => o.id === id)).toBe(true);

    const detail = await get(`/v1/helpdesk/catalogue/offerings/${id}`, userA());
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.olas).toEqual([]);
  });

  it("non-admin cannot create an offering (403)", async () => {
    const res = await createOffering(userA());
    expect(res.statusCode).toBe(403);
  });

  it("citizen role cannot browse (403)", async () => {
    const res = await get("/v1/helpdesk/catalogue/offerings", citizenA());
    expect(res.statusCode).toBe(403);
  });

  it("missing name is a 400 validation error", async () => {
    const res = await post("/v1/helpdesk/catalogue/offerings", adminA(), { category: "x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("duplicate offering name in a tenant is a 409", async () => {
    const name = `Dup ${randomUUID()}`;
    const a = await createOffering(adminA(), { name });
    expect(a.statusCode).toBe(202);
    const b = await post("/v1/helpdesk/catalogue/offerings", adminA(), {
      name,
      category: "access",
      approvalRequired: false,
      fulfilmentStages: [],
      requestFormSchema: [],
      defaultPriority: "Medium",
    });
    expect(b.statusCode).toBe(409);
    expect(b.json().code).toBe("DUPLICATE_OFFERING");
  });

  it("admin can PATCH an offering; unknown id is 404", async () => {
    const c = await createOffering(adminA());
    const id = c.json().data.id as string;
    const upd = await patch(`/v1/helpdesk/catalogue/offerings/${id}`, adminA(), { description: "updated", status: "retired" });
    expect(upd.statusCode).toBe(202);
    await flush();
    const detail = await get(`/v1/helpdesk/catalogue/offerings/${id}`, userA());
    expect(detail.json().data.status).toBe("retired");
    const miss = await patch(`/v1/helpdesk/catalogue/offerings/${randomUUID()}`, adminA(), { description: "x" });
    expect(miss.statusCode).toBe(404);
  });

  it("unknown offering detail is 404", async () => {
    const res = await get(`/v1/helpdesk/catalogue/offerings/${randomUUID()}`, userA());
    expect(res.statusCode).toBe(404);
  });
});

describe("OLA / underpinning-contract tracking", () => {
  it("admin adds OLAs; they surface on the offering detail (tightest first)", async () => {
    const c = await createOffering(adminA());
    const id = c.json().data.id as string;
    const o1 = await post(`/v1/helpdesk/catalogue/offerings/${id}/olas`, adminA(), { name: "ISP UC", kind: "uc", provider: "ISP", targetMinutes: 480 });
    expect(o1.statusCode).toBe(202);
    await flush();
    const o2 = await post(`/v1/helpdesk/catalogue/offerings/${id}/olas`, adminA(), { name: "IT OLA", kind: "ola", provider: "IT", targetMinutes: 120 });
    expect(o2.statusCode).toBe(202);
    await flush();

    const olas = await get(`/v1/helpdesk/catalogue/offerings/${id}/olas`, userA());
    expect(olas.json().data).toHaveLength(2);
    expect(olas.json().data[0].targetMinutes).toBe(120); // ordered tightest-first

    const miss = await post(`/v1/helpdesk/catalogue/offerings/${randomUUID()}/olas`, adminA(), { name: "x", provider: "y", targetMinutes: 10 });
    expect(miss.statusCode).toBe(404);
  });
});

describe("self-service portal — raise request creates fulfilment item + ticket", () => {
  it("raising a request creates a service_request AND a linked ticket", async () => {
    const c = await createOffering(adminA(), { fulfilmentStages: [] });
    const id = c.json().data.id as string;
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, userA(), { formData: { reason: "need access" } });
    expect(raise.statusCode).toBe(202);
    await flush();
    const { requestId, ticketId, status } = raise.json().data;
    expect(status).toBe("pending_fulfilment"); // no stages, no approval
    expect(requestId).toBeTruthy();
    expect(ticketId).toBeTruthy();

    // the linked ticket exists with source=catalogue, sourceRef=requestId
    const ticketRows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(tickets).where(eq(tickets.id, ticketId))),
    );
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0]!.source).toBe("catalogue");
    expect(ticketRows[0]!.sourceRef).toBe(requestId);
  });

  it("no-approval offering WITH stages starts fulfilment at the first stage + logs a raise event", async () => {
    const c = await createOffering(adminA()); // default: no approval, 3 stages
    const id = c.json().data.id as string;
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, userA(), { formData: { reason: "x" } });
    expect(raise.statusCode).toBe(202);
    await flush();
    expect(raise.json().data.status).toBe("in_fulfilment");
    expect(raise.json().data.currentStage).toBe("triage");
    const requestId = raise.json().data.requestId;
    const detail = await get(`/v1/helpdesk/catalogue/requests/${requestId}`, userA());
    expect(detail.json().data.stageEvents.some((e: { toStage: string }) => e.toStage === "triage")).toBe(true);
  });

  it("rejects invalid form data (422)", async () => {
    const c = await createOffering(adminA());
    const id = c.json().data.id as string;
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, userA(), { formData: {} });
    expect(raise.statusCode).toBe(422);
    expect(raise.json().code).toBe("INVALID_FORM_DATA");
  });

  it("rejects raising against a retired offering (409)", async () => {
    const c = await createOffering(adminA());
    const id = c.json().data.id as string;
    await patch(`/v1/helpdesk/catalogue/offerings/${id}`, adminA(), { status: "retired" });
    await flush();
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, userA(), { formData: { reason: "x" } });
    expect(raise.statusCode).toBe(409);
    expect(raise.json().code).toBe("OFFERING_RETIRED");
  });

  it("raising against an unknown offering is 404", async () => {
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${randomUUID()}/requests`, userA(), { formData: { reason: "x" } });
    expect(raise.statusCode).toBe(404);
  });
});

describe("maker-checker approvals + fulfilment workflow", () => {
  it("full happy path: raise → approve (distinct checker) → advance → fulfil (resolves ticket)", async () => {
    const c = await createOffering(adminA(), { approvalRequired: true });
    const id = c.json().data.id as string;

    // maker raises (ADMIN_A)
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, token(TENANT_A, ADMIN_A, ["helpdesk_admin"]), { formData: { reason: "need it" } });
    expect(raise.statusCode).toBe(202);
    await flush();
    const { requestId, ticketId } = raise.json().data;
    expect(raise.json().data.status).toBe("pending_approval");

    // maker-checker: same actor cannot approve their own request
    const self = await post(`/v1/helpdesk/catalogue/requests/${requestId}/approve`, token(TENANT_A, ADMIN_A, ["helpdesk_admin"]), { decision: "approved" });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");

    // distinct checker approves → moves into fulfilment at the first stage
    const appr = await post(`/v1/helpdesk/catalogue/requests/${requestId}/approve`, adminB_A(), { decision: "approved", comment: "ok" });
    expect(appr.statusCode).toBe(202);
    await flush();
    expect(appr.json().data.status).toBe("in_fulfilment");
    expect(appr.json().data.currentStage).toBe("triage");

    // cannot fulfil before terminal stage
    const early = await post(`/v1/helpdesk/catalogue/requests/${requestId}/fulfil`, adminA(), {});
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe("STAGE_NOT_TERMINAL");

    // invalid stage skip
    const skip = await post(`/v1/helpdesk/catalogue/requests/${requestId}/advance`, adminA(), { toStage: "verify" });
    expect(skip.statusCode).toBe(422);
    expect(skip.json().code).toBe("INVALID_STAGE_TRANSITION");

    // advance triage → provision → verify
    expect((await post(`/v1/helpdesk/catalogue/requests/${requestId}/advance`, adminA(), { toStage: "provision" })).statusCode).toBe(202);
    await flush();
    expect((await post(`/v1/helpdesk/catalogue/requests/${requestId}/advance`, adminA(), { toStage: "verify", note: "checked" })).statusCode).toBe(202);
    await flush();

    const done = await post(`/v1/helpdesk/catalogue/requests/${requestId}/fulfil`, adminA(), { note: "granted" });
    expect(done.statusCode).toBe(202);
    await flush();
    expect(done.json().data.status).toBe("fulfilled");

    const ticketRows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(tickets).where(eq(tickets.id, ticketId))),
    );
    expect(ticketRows[0]!.status).toBe("resolved");

    // detail endpoint returns approvals + stage events
    const detail = await get(`/v1/helpdesk/catalogue/requests/${requestId}`, adminA());
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.approvals).toHaveLength(1);
    expect(detail.json().data.stageEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("rejection path: distinct checker rejects → status rejected", async () => {
    const c = await createOffering(adminA(), { approvalRequired: true });
    const id = c.json().data.id as string;
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, token(TENANT_A, ADMIN_A, ["helpdesk_admin"]), { formData: { reason: "x" } });
    await flush();
    const requestId = raise.json().data.requestId;
    const rej = await post(`/v1/helpdesk/catalogue/requests/${requestId}/approve`, adminB_A(), { decision: "rejected", comment: "no" });
    expect(rej.statusCode).toBe(202);
    await flush();
    expect(rej.json().data.status).toBe("rejected");
    // cannot approve again (not pending)
    const again = await post(`/v1/helpdesk/catalogue/requests/${requestId}/approve`, adminB_A(), { decision: "approved" });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("NOT_PENDING_APPROVAL");
  });

  it("no-approval no-stage offering can be fulfilled directly", async () => {
    const c = await createOffering(adminA(), { fulfilmentStages: [] });
    const id = c.json().data.id as string;
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, userA(), { formData: { reason: "x" } });
    await flush();
    const requestId = raise.json().data.requestId;
    const done = await post(`/v1/helpdesk/catalogue/requests/${requestId}/fulfil`, adminA(), {});
    expect(done.statusCode).toBe(202);
    await flush();
    expect(done.json().data.status).toBe("fulfilled");
  });

  it("advance / approve / fulfil on unknown ids are 404", async () => {
    expect((await post(`/v1/helpdesk/catalogue/requests/${randomUUID()}/approve`, adminB_A(), { decision: "approved" })).statusCode).toBe(404);
    expect((await post(`/v1/helpdesk/catalogue/requests/${randomUUID()}/advance`, adminA(), { toStage: "x" })).statusCode).toBe(404);
    expect((await post(`/v1/helpdesk/catalogue/requests/${randomUUID()}/fulfil`, adminA(), {})).statusCode).toBe(404);
  });

  it("cannot advance a request that is not in fulfilment (409)", async () => {
    const c = await createOffering(adminA(), { approvalRequired: true });
    const id = c.json().data.id as string;
    const raise = await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, token(TENANT_A, ADMIN_A, ["helpdesk_admin"]), { formData: { reason: "x" } });
    await flush();
    const requestId = raise.json().data.requestId;
    const adv = await post(`/v1/helpdesk/catalogue/requests/${requestId}/advance`, adminA(), { toStage: "provision" });
    expect(adv.statusCode).toBe(409);
    expect(adv.json().code).toBe("NOT_IN_FULFILMENT");
  });
});

describe("my-requests + breach report", () => {
  it("lists the caller's own requests and the breach report shape", async () => {
    const c = await createOffering(adminA(), { fulfilmentStages: [] });
    const id = c.json().data.id as string;
    await post(`/v1/helpdesk/catalogue/offerings/${id}/requests`, userA(), { formData: { reason: "x" } });
    await flush();

    const mine = await get("/v1/helpdesk/catalogue/requests?mine=true", userA());
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.length).toBeGreaterThanOrEqual(1);
    expect(mine.json().data.every((r: { requestedBy: string }) => r.requestedBy === USER_A)).toBe(true);

    const breaches = await get("/v1/helpdesk/catalogue/requests/breaches", adminA());
    expect(breaches.statusCode).toBe(200);
    expect(breaches.json().summary).toHaveProperty("breached");
    expect(breaches.json().summary).toHaveProperty("escalated");
  });
});

describe("cross-tenant RLS isolation", () => {
  it("tenant B never sees tenant A offerings or requests", async () => {
    const c = await createOffering(adminA());
    const id = c.json().data.id as string;

    const listB = await get("/v1/helpdesk/catalogue/offerings", adminB());
    expect(listB.statusCode).toBe(200);
    expect(listB.json().data.some((o: { id: string }) => o.id === id)).toBe(false);

    const detailB = await get(`/v1/helpdesk/catalogue/offerings/${id}`, adminB());
    expect(detailB.statusCode).toBe(404); // 404 not 403 — no cross-tenant existence leak
  });
});

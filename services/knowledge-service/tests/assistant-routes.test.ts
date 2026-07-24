/**
 * SVC-127 integration — FAQ store, guided flows, grounded virtual assistant
 * (answer + citations), escalate-to-ticket handoff (helpdesk outbox) and
 * deflection metrics.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenant ids each run: the integration DB persists rows across runs, and
// the deflection metric counts every interaction for the tenant.
const TENANT = randomUUID();
const TENANT_METRICS = randomUUID();
const ADMIN = "cccccccc-0000-4000-8000-00000000a001";

function tok(tenant: string, roles: string[], sub = ADMIN) {
  return signToken({ sub, tid: tenant, roles, sid: "sess" }, SECRET, 3600);
}
const adminTok = tok(TENANT, ["knowledge_admin"]);
const userTok = tok(TENANT, ["knowledge_user"]);

let app: FastifyInstance;

function idOf(res: { json: () => unknown }): string {
  const b = res.json() as { id?: string; data?: { id?: string } };
  return (b.data?.id ?? b.id)!;
}
async function outboxByCorrelation(tenant: string, cid: string): Promise<Array<{ topic: string; payload: Record<string, unknown> }>> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    const rows = await sql`SELECT topic, payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND correlation_id = ${cid}`;
    return (rows as unknown as Array<{ topic: string; payload: unknown }>).map((r) => ({
      topic: r.topic,
      payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
    }));
  });
}

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("SVC-127 FAQ store", () => {
  let faqId: string;

  it("creates, reads, updates and deletes a FAQ", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/knowledge/faqs",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { question: "How do I apply for leave?", answer: "Use the HRMS leave portal.", category: "hr", tags: ["leave"] },
    });
    expect(create.statusCode).toBe(202);
    faqId = idOf(create);

    const get = await app.inject({ method: "GET", url: `/v1/knowledge/faqs/${faqId}`, headers: { authorization: `Bearer ${userTok}` } });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { question: string }).question).toContain("leave");

    const list = await app.inject({ method: "GET", url: "/v1/knowledge/faqs?category=hr", headers: { authorization: `Bearer ${userTok}` } });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);

    const upd = await app.inject({
      method: "PUT", url: `/v1/knowledge/faqs/${faqId}`,
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { answer: "Apply via the HRMS portal under Leave." },
    });
    expect(upd.statusCode).toBe(202);

    const del = await app.inject({ method: "DELETE", url: `/v1/knowledge/faqs/${faqId}`, headers: { authorization: `Bearer ${adminTok}` } });
    expect(del.statusCode).toBe(202);
    const gone = await app.inject({ method: "GET", url: `/v1/knowledge/faqs/${faqId}`, headers: { authorization: `Bearer ${userTok}` } });
    expect(gone.statusCode).toBe(404);
  });

  it("forbids FAQ writes for non-admins", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/faqs",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "q", answer: "a" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("SVC-127 guided support flows", () => {
  it("creates and reads an ordered guided flow", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/knowledge/guided-flows",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: {
        title: "Reset your password",
        description: "Step-by-step reset",
        steps: [
          { title: "Open portal", instruction: "Go to id.gov" },
          { title: "Click reset", instruction: "Use the reset link" },
        ],
      },
    });
    expect(create.statusCode).toBe(202);
    const id = idOf(create);

    const get = await app.inject({ method: "GET", url: `/v1/knowledge/guided-flows/${id}`, headers: { authorization: `Bearer ${userTok}` } });
    const flow = get.json() as { steps: Array<{ order: number; title: string }> };
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]!.order).toBe(1);
    expect(flow.steps[1]!.order).toBe(2);

    const upd = await app.inject({
      method: "PUT", url: `/v1/knowledge/guided-flows/${id}`,
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { steps: [{ title: "One", instruction: "only step" }] },
    });
    expect(upd.statusCode).toBe(202);

    const list = await app.inject({ method: "GET", url: "/v1/knowledge/guided-flows", headers: { authorization: `Bearer ${userTok}` } });
    expect(Array.isArray(list.json())).toBe(true);

    const missing = await app.inject({ method: "GET", url: `/v1/knowledge/guided-flows/cccccccc-0000-4000-8000-0000000000ff`, headers: { authorization: `Bearer ${userTok}` } });
    expect(missing.statusCode).toBe(404);
  });
});

describe("SVC-127 grounded virtual assistant", () => {
  it("answers from the knowledge repo with citations", async () => {
    // Seed a published FAQ to ground the answer.
    await app.inject({
      method: "POST", url: "/v1/knowledge/faqs",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { question: "How to apply for annual leave", answer: "Submit a leave request in HRMS.", category: "hr" },
    });

    const ask = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "apply annual leave" },
    });
    expect(ask.statusCode).toBe(200);
    const data = (ask.json() as { data: { answered: boolean; citations: Array<{ source: string }>; answer: string } }).data;
    expect(data.answered).toBe(true);
    expect(data.citations.length).toBeGreaterThan(0);
    expect(data.citations.some((c) => c.source === "faq")).toBe(true);
    expect(data.answer.length).toBeGreaterThan(0);
  });

  it("returns an unanswered result when nothing grounds the question", async () => {
    const ask = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "zzxq nonexistent topic wobble" },
    });
    expect(ask.statusCode).toBe(200);
    const data = (ask.json() as { data: { answered: boolean; grounded: boolean } }).data;
    expect(data.answered).toBe(false);
    expect(data.grounded).toBe(false);
  });

  it("escalate-to-ticket emits a helpdesk.ticket.create outbox command", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/escalate",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "My VPN is broken", detail: "Cannot connect since morning", priority: "High" },
    });
    expect(res.statusCode).toBe(202);
    const cid = (res.json() as { correlationId?: string; data?: { correlationId?: string } });
    const correlationId = (cid.data?.correlationId ?? cid.correlationId)!;
    const msgs = await outboxByCorrelation(TENANT, correlationId);
    const ticket = msgs.find((m) => m.topic === "helpdesk.ticket.create");
    expect(ticket).toBeDefined();
    expect(ticket!.payload.subject).toContain("VPN");
    expect(ticket!.payload.priority).toBe("High");
    expect(msgs.some((m) => m.topic === "knowledge.assistant.escalated")).toBe(true);
  });

  it("escalating an existing interaction flags it as escalated", async () => {
    const ask = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "obscure unanswerable thing wibble" },
    });
    const interactionId = (ask.json() as { data: { interactionId: string } }).data.interactionId;
    const esc = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/escalate",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "obscure unanswerable thing wibble", interactionId },
    });
    expect(esc.statusCode).toBe(202);
    const correlationId = (esc.json() as { correlationId?: string; data?: { correlationId?: string } });
    const cid = (correlationId.data?.correlationId ?? correlationId.correlationId)!;
    const msgs = await outboxByCorrelation(TENANT, cid);
    const ticket = msgs.find((m) => m.topic === "helpdesk.ticket.create");
    expect(ticket!.payload.externalRef).toBeDefined();
  });
});

describe("SVC-127 deflection metrics", () => {
  it("computes answered vs escalated over interactions", async () => {
    const uTok = tok(TENANT_METRICS, ["knowledge_user"]);
    const aTok = tok(TENANT_METRICS, ["knowledge_admin"]);
    // one grounded answer (deflected)
    await app.inject({
      method: "POST", url: "/v1/knowledge/faqs",
      headers: { authorization: `Bearer ${aTok}`, "content-type": "application/json" },
      payload: { question: "office holiday calendar", answer: "See the intranet calendar." },
    });
    await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${uTok}`, "content-type": "application/json" },
      payload: { question: "holiday calendar" },
    });
    // one escalation
    await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/escalate",
      headers: { authorization: `Bearer ${uTok}`, "content-type": "application/json" },
      payload: { question: "Printer jam", priority: "Low" },
    });

    const res = await app.inject({ method: "GET", url: "/v1/knowledge/assistant/metrics", headers: { authorization: `Bearer ${aTok}` } });
    expect(res.statusCode).toBe(200);
    const m = res.json() as { total: number; answered: number; escalated: number; deflected: number; deflectionRate: number };
    expect(m.total).toBe(2);
    expect(m.answered).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.deflected).toBe(1);
    expect(m.deflectionRate).toBe(50);
  });
});

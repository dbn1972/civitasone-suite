/**
 * F6-02 — resolve/close -> citizen notification.
 *
 * On resolve/close the SR status route enqueues notifyServiceRequestResolution
 * (no PII in the payload). The consumer reads the SR for the citizen channel,
 * calls notification-service out-of-band (stubbed here), and writes the delivery
 * result back as an activity, with a domain + audit event.
 *
 * FAILS on the old code: the command topic, its consumer and the enqueue did not
 * exist, so resolving an SR notified no one.
 *
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-04 — the cross-service contract. The old call
 * carried no credential (notification-service answers 401) and put a template
 * NAME where notification-service requires a UUID (400), so a real send could
 * never succeed; the tests stubbed fetch and never exercised it. The stub below
 * now enforces notification-service's contract: it rejects a request without the
 * internal credential and a non-UUID templateId, exactly as the real service
 * does. The outcome is also surfaced to the officer: on the PATCH response, and
 * on the request itself.
 *
 * DB-backed; the notification HTTP calls are stubbed.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { captureHandlers, envelope } from "./consumer-harness.js";
import { runWithTenant } from "@civitasone/db";
import { COMMANDS, EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_TEMPLATE = randomUUID();
const SMS_TEMPLATE = randomUUID();

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
/** What POST /notifications/send answers; reset to a 202 before every test. */
let sendResponse: () => { ok: boolean; status: number; json: () => Promise<unknown> };
/** The tenant's notification templates; reset to both channels before every test. */
let templates: Array<Record<string, unknown>>;

const okSend = () => ({ ok: true, status: 202, json: async () => ({ id: randomUUID(), status: "accepted" }) });
const resolutionTemplates = () => [
  { id: EMAIL_TEMPLATE, name: "service_request_resolution", channel: "email", status: "active" },
  { id: SMS_TEMPLATE, name: "service_request_resolution", channel: "sms", status: "active" },
];

/** Stands in for notification-service: same auth + validation rules as the real one. */
function notificationServiceStub(url: unknown, opts?: { headers?: Record<string, string>; body?: string; method?: string }) {
  const h = opts?.headers ?? {};
  const authed =
    h["x-internal"] === "1" &&
    h["x-tenant-id"] === TENANT &&
    typeof h["x-service-secret"] === "string" &&
    h["x-service-secret"] === process.env.INTERNAL_SERVICE_SECRET &&
    h["x-service-secret"].length > 0;
  if (!authed) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
  const path = String(url);
  if (path.endsWith("/notifications/templates")) {
    return Promise.resolve({ ok: true, status: 200, json: async () => templates });
  }
  if (path.endsWith("/notifications/send")) {
    const body = JSON.parse(opts?.body ?? "{}") as { templateId?: string };
    if (typeof body.templateId !== "string" || !UUID_RE.test(body.templateId)) {
      return Promise.resolve({ ok: false, status: 400, json: async () => ({}) });
    }
    return Promise.resolve(sendResponse());
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

const app = await buildApp();
const handlers = captureHandlers();

beforeAll(() => {
  process.env.INTERNAL_SERVICE_SECRET ||= globalThis.crypto.randomUUID();
  fetchMock = vi.fn(notificationServiceStub);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
  sendResponse = okSend;
  templates = resolutionTemplates();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function req(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({ method: method as "GET", url, headers: headers(), ...(payload ? { payload } : {}) });
}

async function createSr(extra: Record<string, unknown>): Promise<string> {
  const res = await req("POST", "/v1/crm/service-requests", {
    citizenName: "Asha Rao",
    serviceType: "Birth Certificate",
    subject: "Correction",
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function runNotify(serviceRequestId: string, status: string): Promise<void> {
  const handler = handlers.handlerFor(COMMANDS.notifyServiceRequestResolution);
  const msg = envelope(
    COMMANDS.notifyServiceRequestResolution,
    { serviceRequestId, tenantId: TENANT, status },
    { tenantId: TENANT, actorId: ACTOR },
  );
  await runWithTenant(TENANT, () => handler(msg));
}

/** The calls the consumer made to POST /notifications/send. */
function sendCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/notifications/send"));
}

async function activityRows(srRef: string): Promise<Array<Record<string, unknown>>> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<Record<string, unknown>>>`
      SELECT type, subject, text, status FROM crm.activities
      WHERE tenant_id = ${TENANT} AND text LIKE ${"%" + srRef + "%"}
    `;
  });
}

async function auditOutcomes(id: string): Promise<string[]> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<{ outcome: string; action: string }>>`
      SELECT payload->>'outcome' AS outcome, payload->>'action' AS action
      FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${id}
        AND payload->>'action' LIKE 'service_request_notify%'
    `;
  });
  return rows.map((r) => `${r.action}:${r.outcome}`);
}

async function detail(id: string): Promise<Record<string, unknown>> {
  const res = await req("GET", `/v1/crm/service-requests/${id}`);
  expect(res.statusCode).toBe(200);
  return res.json().data as Record<string, unknown>;
}

describe("F6-02: resolve -> citizen notification", () => {
  it("enqueues the notify command on resolve and the consumer sends + logs an activity", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com" });
    const ref = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.referenceNo as string;

    const resolved = await req("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "resolved",
      resolution: "Done",
    });
    expect(resolved.statusCode).toBe(200);

    // The command landed in the outbox (route enqueues in-tx).
    const queued = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND event_type = ${COMMANDS.notifyServiceRequestResolution}
          AND payload->>'serviceRequestId' = ${id}
      `;
    });
    expect(queued[0]!.n).toBe(1);

    await runNotify(id, "resolved");

    // notification-service was called exactly once to SEND, with no PII in the URL.
    expect(sendCalls()).toHaveLength(1);
    const [url, opts] = sendCalls()[0]!;
    expect(String(url)).toContain("/notifications/send");
    expect(String(url)).not.toContain("asha");
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.channel).toBe("email");
    expect(body.recipient).toBe("asha@example.com");

    const acts = await activityRows(ref);
    expect(acts.length).toBe(1);
    expect(acts[0]!.type).toBe("comm_delivery");
    expect(String(acts[0]!.text)).toContain("sent");

    expect(await auditOutcomes(id)).toContain("service_request_notify:sent");
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-04: the real contract.
  it("authenticates to notification-service and sends the template UUID, not a template name", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com" });
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");

    const [, opts] = sendCalls()[0]!;
    const h = (opts as { headers: Record<string, string> }).headers;
    expect(h["x-internal"]).toBe("1");
    expect(h["x-tenant-id"]).toBe(TENANT);
    expect(h["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.templateId).toBe(EMAIL_TEMPLATE);
    // The stub answered 202 (not 401/400), so the request recorded a real send.
    expect((await detail(id)).citizenNotification).toMatchObject({ channel: "email", outcome: "sent" });
  });

  it("picks the template for the channel it will use (SMS when only a phone is on file)", async () => {
    const id = await createSr({ citizenPhone: "+919812345678" });
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");
    const body = JSON.parse((sendCalls()[0]![1] as { body: string }).body);
    expect(body.channel).toBe("sms");
    expect(body.templateId).toBe(SMS_TEMPLATE);
  });

  it("records no_template (no send, honest outcome) when the tenant has not created the template", async () => {
    templates = []; // the tenant never created "service_request_resolution"
    const id = await createSr({ citizenEmail: "asha@example.com" });
    const ref = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.referenceNo as string;
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");

    expect(sendCalls()).toHaveLength(0);
    expect(await auditOutcomes(id)).toContain("service_request_notify:no_template");
    const acts = await activityRows(ref);
    expect(acts).toHaveLength(1);
    expect(String(acts[0]!.text)).toMatch(/not sent/);
    // ...and the officer can see it on the request, rather than a silent drop.
    expect((await detail(id)).citizenNotification).toMatchObject({ channel: "email", outcome: "no_template" });
  });

  it("ignores a template that is not active or is for another channel", async () => {
    templates = [
      { id: randomUUID(), name: "service_request_resolution", channel: "email", status: "draft" },
      { id: randomUUID(), name: "service_request_resolution", channel: "sms", status: "active" },
      { id: randomUUID(), name: "something_else", channel: "email", status: "active" },
    ];
    const id = await createSr({ citizenEmail: "asha@example.com" });
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");
    expect(sendCalls()).toHaveLength(0);
    expect((await detail(id)).citizenNotification).toMatchObject({ outcome: "no_template" });
  });

  // A template that went through notification-service's approval workflow
  // (draft -> in_review -> approved -> published) ends "published", not "active".
  it("uses a PUBLISHED template (approval-workflow end state), not just an `active` one", async () => {
    const PUBLISHED_EMAIL = randomUUID();
    templates = [{ id: PUBLISHED_EMAIL, name: "service_request_resolution", channel: "email", status: "published" }];
    const id = await createSr({ citizenEmail: "asha@example.com" });
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");

    expect(sendCalls()).toHaveLength(1);
    const body = JSON.parse((sendCalls()[0]![1] as { body: string }).body);
    expect(body.templateId).toBe(PUBLISHED_EMAIL);
    expect(body.channel).toBe("email");
    expect((await detail(id)).citizenNotification).toMatchObject({ channel: "email", outcome: "sent" });
    expect(await auditOutcomes(id)).not.toContain("service_request_notify:no_template");
  });

  it("does not use a template still awaiting approval or superseded (in_review / approved / superseded -> no_template)", async () => {
    templates = [
      { id: randomUUID(), name: "service_request_resolution", channel: "email", status: "in_review" },
      { id: randomUUID(), name: "service_request_resolution", channel: "email", status: "approved" },
      { id: randomUUID(), name: "service_request_resolution", channel: "email", status: "superseded" },
    ];
    const id = await createSr({ citizenEmail: "asha@example.com" });
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");
    expect(sendCalls()).toHaveLength(0);
    expect((await detail(id)).citizenNotification).toMatchObject({ outcome: "no_template" });
  });

  it("skips (no send) when the request has no citizen phone/email", async () => {
    const id = await createSr({});
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await auditOutcomes(id)).toContain("service_request_notify_skipped:no_contact_channel");
    expect((await detail(id)).citizenNotification).toMatchObject({ channel: null, outcome: "no_contact" });
  });

  it("a TRANSIENT failure throws, writes nothing, and a redelivery of the same message then sends once", async () => {
    const id = await createSr({ citizenPhone: "+919812345678" });
    const ref = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.referenceNo as string;
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    const handler = handlers.handlerFor(COMMANDS.notifyServiceRequestResolution);
    const msg = envelope(
      COMMANDS.notifyServiceRequestResolution,
      { serviceRequestId: id, tenantId: TENANT, status: "resolved" },
      { tenantId: TENANT, actorId: ACTOR },
    );

    fetchMock.mockClear();
    sendResponse = () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(runWithTenant(TENANT, () => handler(msg))).rejects.toThrow(/will retry/);
    expect((await activityRows(ref)).length).toBe(0);

    // Same messageId redelivered, notification-service is back: it is sent and recorded once.
    sendResponse = okSend;
    await runWithTenant(TENANT, () => handler(msg));
    expect(sendCalls()).toHaveLength(2);
    expect((await activityRows(ref)).length).toBe(1);
    // A further redelivery is a no-op (already processed, no second send).
    await runWithTenant(TENANT, () => handler(msg));
    expect(sendCalls()).toHaveLength(2);
  });

  it("records a failed delivery as an activity when notification-service rejects permanently (4xx)", async () => {
    const id = await createSr({ citizenPhone: "+919812345678" });
    const ref = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.referenceNo as string;
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });

    fetchMock.mockClear();
    sendResponse = () => ({ ok: false, status: 422, json: async () => ({}) });
    await runNotify(id, "resolved");

    // SMS channel chosen since only a phone is present.
    const body = JSON.parse((sendCalls()[0]![1] as { body: string }).body);
    expect(body.channel).toBe("sms");

    const acts = await activityRows(ref);
    expect(acts.length).toBe(1);
    expect(String(acts[0]!.text)).toContain("failed");
    expect(await auditOutcomes(id)).toContain("service_request_notify:failed");
    // The failure is visible on the request, not only in an audit row.
    expect((await detail(id)).citizenNotification).toMatchObject({ channel: "sms", outcome: "failed" });
  });

  it("a delivery result does not bump the request version (an open page stays current)", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com" });
    const patch = await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    const versionAfterResolve = patch.json().data.version as number;
    await runNotify(id, "resolved");
    expect((await detail(id)).version).toBe(versionAfterResolve);
  });

  it("defines the citizen-notified domain event", () => {
    expect(EVENTS.serviceRequestCitizenNotified).toBe("crm.service_request.citizen_notified");
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-04: the status response says what happens to the citizen notice", () => {
  it("reports queued + the channel when the request has an email", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com" });
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notification).toEqual({ state: "queued", channel: "email" });
    // Internal columns never leak into the response.
    expect(res.json().data).not.toHaveProperty("notifyChannel");
    expect(res.json().data).not.toHaveProperty("notifyOutcome");
  });

  it("reports queued over SMS when only a phone is on file", async () => {
    const id = await createSr({ citizenPhone: "+919812345678" });
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    expect(res.json().data.notification).toEqual({ state: "queued", channel: "sms" });
  });

  it("prefers email when both are on file", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com", citizenPhone: "+919812345678" });
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "closed", statusNote: "Closing remarks here" });
    expect(res.json().data.notification).toEqual({ state: "queued", channel: "email" });
  });

  it("says no_contact immediately - and nothing is queued to send - when there is no phone or email", async () => {
    const id = await createSr({});
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notification).toEqual({ state: "no_contact", channel: null });
    // The request itself records it, before any consumer has run.
    expect((await detail(id)).citizenNotification).toMatchObject({ channel: null, outcome: "no_contact" });
  });

  it("has no notification block for a transition that notifies nobody", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com" });
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "in_progress" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).not.toHaveProperty("notification");
    expect((await detail(id)).citizenNotification).toBeNull();
  });

  it("a detail of a request that was never resolved has no notification", async () => {
    const id = await createSr({ citizenEmail: "asha@example.com" });
    expect((await detail(id)).citizenNotification).toBeNull();
  });
});

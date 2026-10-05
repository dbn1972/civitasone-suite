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
 * DB-backed; the notification HTTP call is stubbed.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { captureHandlers, envelope } from "./consumer-harness.js";
import { runWithTenant } from "@civitasone/db";
import { COMMANDS, EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

const app = await buildApp();
const handlers = captureHandlers();

beforeAll(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deliveryId: randomUUID() }) });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
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

    // notification-service was called exactly once, with no PII in the URL.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/notifications/send");
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.channel).toBe("email");
    expect(body.recipient).toBe("asha@example.com");

    const acts = await activityRows(ref);
    expect(acts.length).toBe(1);
    expect(acts[0]!.type).toBe("comm_delivery");
    expect(String(acts[0]!.text)).toContain("sent");

    expect(await auditOutcomes(id)).toContain("service_request_notify:sent");
  });

  it("skips (no send) when the request has no citizen phone/email", async () => {
    const id = await createSr({});
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });
    fetchMock.mockClear();
    await runNotify(id, "resolved");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await auditOutcomes(id)).toContain("service_request_notify_skipped:no_contact_channel");
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
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(runWithTenant(TENANT, () => handler(msg))).rejects.toThrow(/will retry/);
    expect((await activityRows(ref)).length).toBe(0);

    // Same messageId redelivered, notification-service is back: it is sent and recorded once.
    await runWithTenant(TENANT, () => handler(msg));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await activityRows(ref)).length).toBe(1);
    // A further redelivery is a no-op (already processed, no second send).
    await runWithTenant(TENANT, () => handler(msg));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records a failed delivery as an activity when notification-service rejects permanently (4xx)", async () => {
    const id = await createSr({ citizenPhone: "+919812345678" });
    const ref = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.referenceNo as string;
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "resolved", resolution: "Done" });

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({}) });
    await runNotify(id, "resolved");

    // SMS channel chosen since only a phone is present.
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.channel).toBe("sms");

    const acts = await activityRows(ref);
    expect(acts.length).toBe(1);
    expect(String(acts[0]!.text)).toContain("failed");
    expect(await auditOutcomes(id)).toContain("service_request_notify:failed");
  });

  it("defines the citizen-notified domain event", () => {
    expect(EVENTS.serviceRequestCitizenNotified).toBe("crm.service_request.citizen_notified");
  });
});

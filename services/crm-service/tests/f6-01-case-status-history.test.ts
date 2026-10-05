/**
 * F6-01 — case status history for service requests and RTI requests.
 *
 * Every status transition is recorded in crm.case_status_history in the SAME tx
 * as the transition, and exposed via GET .../:id/history as an ordered timeline.
 *
 * FAILS on the old code: the table and the two /history routes did not exist.
 *
 * DB-backed, HTTP round-trip.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const app = await buildApp();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.rti_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function req(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: method as "GET",
    url,
    headers: headers(),
    ...(payload ? { payload } : {}),
  });
}

describe("F6-01: service-request status history", () => {
  it("records the opening transition and each subsequent one in order", async () => {
    const created = await req("POST", "/v1/crm/service-requests", {
      citizenName: "Asha Rao",
      serviceType: "Birth Certificate",
      subject: "Certificate correction",
      priority: "normal",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    await req("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "in_progress",
    });
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "resolved",
      resolution: "Issued corrected certificate",
    });

    const hist = await req("GET", `/v1/crm/service-requests/${id}/history`);
    expect(hist.statusCode).toBe(200);
    const rows = hist.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    // Oldest first.
    expect(rows[0]!.fromStatus).toBeNull();
    expect(rows[0]!.toStatus).toBe("open");
    expect(rows[1]!.fromStatus).toBe("open");
    expect(rows[1]!.toStatus).toBe("in_progress");
    expect(rows[2]!.fromStatus).toBe("in_progress");
    expect(rows[2]!.toStatus).toBe("resolved");
    expect(rows[2]!.note).toBe("Issued corrected certificate");
    expect(rows[2]!.actorId).toBe(ACTOR);
  });

  it("404s history for an unknown service request", async () => {
    const res = await req("GET", `/v1/crm/service-requests/${randomUUID()}/history`);
    expect(res.statusCode).toBe(404);
  });

  it("does not record a transition for a stale (409) write", async () => {
    const created = await req("POST", "/v1/crm/service-requests", {
      citizenName: "Bob",
      serviceType: "Water Connection",
      subject: "New connection",
    });
    const id = created.json().data.id as string;
    const v0 = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.version as number;
    // Advance once (consumes v0), then try the stale version again.
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "in_progress", version: v0 });
    const stale = await req("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "pending", version: v0, statusNote: "stale",
    });
    expect(stale.statusCode).toBe(409);
    const rows = (await req("GET", `/v1/crm/service-requests/${id}/history`)).json().data as unknown[];
    // open + in_progress only — the stale pending was never recorded.
    expect(rows.length).toBe(2);
  });
});

describe("F6-01: RTI status history", () => {
  it("records RECEIVED then each lifecycle transition", async () => {
    const created = await req("POST", "/v1/crm/rti", {
      section: "s.6",
      departmentRef: "REVENUE",
      applicantName: "Appeal Applicant",
      subject: "Mutation register extracts",
      description: "Copies of mutation entries for survey no. 42.",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    expect((await req("PATCH", `/v1/crm/rti/${id}/respond`, { responseText: "Records enclosed." })).statusCode).toBe(200);
    expect((await req("PATCH", `/v1/crm/rti/${id}/first-appeal`)).statusCode).toBe(200);

    const hist = await req("GET", `/v1/crm/rti/${id}/history`);
    expect(hist.statusCode).toBe(200);
    const rows = hist.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    expect(rows[0]!.fromStatus).toBeNull();
    expect(rows[0]!.toStatus).toBe("RECEIVED");
    expect(rows[1]!.fromStatus).toBe("RECEIVED");
    expect(rows[1]!.toStatus).toBe("RESPONDED");
    expect(rows[2]!.fromStatus).toBe("RESPONDED");
    expect(rows[2]!.toStatus).toBe("FIRST_APPEAL");
  });

  it("404s history for an unknown RTI id", async () => {
    const res = await req("GET", `/v1/crm/rti/${randomUUID()}/history`);
    expect(res.statusCode).toBe(404);
  });
});

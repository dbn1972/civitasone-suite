/**
 * F6-03 — SLA auto-derivation for service requests.
 *
 * service_types gains an optional sla_hours. On SR create with no explicit
 * dueAt, the server derives due_at = created_at + sla_hours when the picked type
 * carries an SLA; an explicit dueAt always wins; a type with no SLA leaves due_at
 * NULL (today's behaviour). The admin service-types editor accepts slaHours.
 *
 * FAILS on the old code: service_types had no sla_hours column and the create
 * route never derived a due date.
 *
 * DB-backed, HTTP round-trip.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

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
registerAllConsumers(queue);
await queue.start();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.service_types WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function req(method: string, url: string, payload?: Record<string, unknown>) {
  return app.inject({ method: method as "GET", url, headers: headers(), ...(payload ? { payload } : {}) });
}

describe("F6-03: service-type SLA editor", () => {
  it("accepts and returns slaHours on create and update", async () => {
    const created = await req("POST", "/v1/crm/service-types", {
      code: "birth_cert",
      label: "Birth Certificate",
      slaHours: 72,
    });
    // Service-type writes are CQRS now: 202, then the consumer applies them.
    expect(created.statusCode).toBe(202);
    await drainQueue();
    const slaOf = async (code: string) => {
      const list = await req("GET", "/v1/crm/service-types");
      return (list.json().data as Array<{ id: string; code: string; slaHours: number | null }>).find((r) => r.code === code);
    };
    const row = await slaOf("birth_cert");
    expect(row?.slaHours).toBe(72);
    const stId = row!.id;

    const updated = await req("PUT", `/v1/crm/service-types/${stId}`, { slaHours: 24 });
    expect(updated.statusCode).toBe(202);
    await drainQueue();
    expect((await slaOf("birth_cert"))?.slaHours).toBe(24);

    // Clearing the SLA is allowed.
    const cleared = await req("PUT", `/v1/crm/service-types/${stId}`, { slaHours: null });
    expect(cleared.statusCode).toBe(202);
    await drainQueue();
    expect((await slaOf("birth_cert"))?.slaHours ?? null).toBeNull();

    // Out-of-range SLA is rejected.
    const bad = await req("POST", "/v1/crm/service-types", { code: "bad_sla", label: "Bad", slaHours: 0 });
    expect(bad.statusCode).toBe(400);
  });
});

describe("F6-03: SR create derives due_at from the picked type's SLA", () => {
  it("sets due_at = created_at + sla_hours when no dueAt is supplied (matched by label)", async () => {
    const st = await req("POST", "/v1/crm/service-types", {
      code: "water_conn",
      label: "Water Connection",
      slaHours: 48,
    });
    expect(st.statusCode).toBe(202);
    await drainQueue();

    const created = await req("POST", "/v1/crm/service-requests", {
      citizenName: "Asha Rao",
      serviceType: "Water Connection",
      subject: "New connection",
    });
    expect(created.statusCode).toBe(201);
    const data = created.json().data as { dueAt: string | null; createdAt: string };
    expect(data.dueAt).not.toBeNull();

    const diffMs = new Date(data.dueAt!).getTime() - new Date(data.createdAt).getTime();
    const diffHours = diffMs / 3_600_000;
    // 48h within a small tolerance (SLA uses now(); createdAt uses the row default).
    expect(Math.abs(diffHours - 48)).toBeLessThan(0.05);
  });

  it("honours an explicit dueAt over the SLA", async () => {
    await req("POST", "/v1/crm/service-types", { code: "pan_card", label: "PAN Card", slaHours: 10 });
    await drainQueue();
    const explicit = new Date("2027-01-01T00:00:00.000Z").toISOString();
    const created = await req("POST", "/v1/crm/service-requests", {
      citizenName: "Bob",
      serviceType: "PAN Card",
      subject: "x",
      dueAt: explicit,
    });
    expect(created.statusCode).toBe(201);
    expect(new Date(created.json().data.dueAt as string).toISOString()).toBe(explicit);
  });

  it("leaves due_at NULL for a type with no SLA", async () => {
    await req("POST", "/v1/crm/service-types", { code: "misc", label: "Misc" });
    const created = await req("POST", "/v1/crm/service-requests", {
      citizenName: "Cara",
      serviceType: "Misc",
      subject: "x",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.dueAt ?? null).toBeNull();
  });
});

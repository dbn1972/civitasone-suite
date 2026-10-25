/**
 * CLOS3-S4-09 (event-service): application and permit reference numbers come from Postgres
 * sequences, so two commands can never collide on the UNIQUE number column and lose an already
 * accepted (202) request. randomInt(1, 999999) is pinned to a constant to make the old behaviour
 * collide deterministically.
 *
 * Real Postgres as the non-superuser event_svc role (FORCE RLS enforced).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    // only the reference-number call (1, 999999) is pinned; verification codes etc. stay random
    randomInt: ((min: number, max?: number, cb?: unknown) =>
      min === 1 && max === 999999 ? 1 : (actual.randomInt as (...a: unknown[]) => unknown)(min, max, cb)) as typeof actual.randomInt,
  };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerNocConsumers } from "../src/modules/nocs/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerPostEventConsumers } from "../src/modules/post_event/consumer.js";
import { hdr, drainQueue, waitFor } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  registerNocConsumers(queue);
  registerPermitConsumers(queue);
  registerPostEventConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createApplication(): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/event/applications",
    headers: hdr(),
    payload: {
      organiserName: "Seq Test Org",
      organiserPhone: "9876500009",
      eventType: "sports",
      venueName: "Test Ground",
      venueAddress: { line1: "1 Test St", city: "Springfield", pin: "500001" },
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      expectedAttendance: 80,
    },
  });
  expect(create.statusCode).toBe(202);
  return (create.json() as { id: string }).id;
}
const getApplication = async (id: string) =>
  (await app.inject({ method: "GET", url: `/v1/event/applications/${id}`, headers: hdr() }));

describe("event reference numbers are sequence-backed (real Postgres)", () => {
  it("two createApplication commands both persist, with distinct application numbers", async () => {
    const a = await createApplication();
    const b = await createApplication();
    await drainQueue();
    const ra = await getApplication(a);
    const rb = await getApplication(b);
    // old behaviour: the second insert hit the UNIQUE violation and the accepted request was lost (404)
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    const na = ra.json().data.applicationNumber as string;
    const nb = rb.json().data.applicationNumber as string;
    expect(na).not.toBe(nb);
    expect(na).toMatch(/^EVT\/ULB\/\d{4}\/\d{6}$/);
  });

  it("two issuePermit commands both persist, with distinct permit numbers", async () => {
    const eligible = async (): Promise<string> => {
      const id = await createApplication();
      await waitFor(async () => (await getApplication(id)).statusCode === 200);
      await app.inject({ method: "POST", url: `/v1/event/applications/${id}/submit`, headers: hdr() });
      await drainQueue();
      const noc = await app.inject({ method: "POST", url: "/v1/event/nocs", headers: hdr(), payload: { applicationId: id, department: "police" } });
      const nocId = (noc.json() as { id: string }).id;
      await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/event/nocs?applicationId=${id}`, headers: hdr() })).json().data.some((r: { id: string }) => r.id === nocId));
      await app.inject({ method: "POST", url: `/v1/event/nocs/${nocId}/respond`, headers: hdr(), payload: { status: "approved" } });
      await drainQueue();
      return id;
    };
    const issue = async (applicationId: string): Promise<string> => {
      const res = await app.inject({
        method: "POST", url: "/v1/event/permits", headers: hdr(),
        payload: { applicationId, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" },
      });
      expect(res.statusCode).toBe(202);
      return (res.json() as { id: string }).id;
    };
    const p1 = await issue(await eligible());
    const p2 = await issue(await eligible());
    await drainQueue();
    const r1 = await app.inject({ method: "GET", url: `/v1/event/permits/${p1}`, headers: hdr() });
    const r2 = await app.inject({ method: "GET", url: `/v1/event/permits/${p2}`, headers: hdr() });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const n1 = r1.json().data.permitNumber as string;
    const n2 = r2.json().data.permitNumber as string;
    expect(n1).not.toBe(n2);
    expect(n1).toMatch(/^EVTP\/ULB\/\d{4}\/\d{6}$/);
  });
});

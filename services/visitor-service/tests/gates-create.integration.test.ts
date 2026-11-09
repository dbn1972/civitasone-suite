/**
 * UAT bundle 23: there was no API to create a visitor gate, so a tenant with no gate could not use
 * check-in/out, device registration or any gate flow (all of them need a gate id).
 *
 * POST /v1/visitor/locations/:id/gates  - queue-first like locations/areas (202 + id), admin roles only
 * GET  /v1/visitor/locations/:id/gates  - list a location's gates
 * Driven against a real Postgres as the non-superuser visitor_svc role (RLS in force).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { locations, areas, gates } from "../src/modules/location/schema.js";
import { registerLocationConsumers } from "../src/modules/location/consumer.js";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const LOCATION = randomUUID();
const OTHER_LOCATION = randomUUID();
const AREA_HERE = randomUUID();
const AREA_ELSEWHERE = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function headers(roles: string[], tid = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-b23-gate" }, SECRET, 3600)}`,
    "content-type": "application/json",
  };
}
const admin = () => headers(["security_admin"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // Run the real consumer under the message tenant, exactly like worker.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = appQueue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (m: any) => Promise<void>, opts?: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)), opts);
  registerLocationConsumers(appQueue);
  await q.start?.();

  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(locations).values([
      { id: LOCATION, tenantId: TENANT, name: "Secretariat Main Building", businessHours: HOURS, createdBy: ACTOR, updatedBy: ACTOR },
      { id: OTHER_LOCATION, tenantId: TENANT, name: "Annexe Block B", businessHours: HOURS, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(areas).values([
      { id: AREA_HERE, tenantId: TENANT, locationId: LOCATION, name: "Reception", createdBy: ACTOR, updatedBy: ACTOR },
      { id: AREA_ELSEWHERE, tenantId: TENANT, locationId: OTHER_LOCATION, name: "Annexe Lobby", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(gates).where(eq(gates.tenantId, TENANT));
    await tx.delete(areas).where(eq(areas.tenantId, TENANT));
    await tx.delete(locations).where(eq(locations.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("visitor gates API", () => {
  it("creates a gate (202), persists it through the consumer, and lists it", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: `/v1/visitor/locations/${LOCATION}/gates`, headers: admin(),
        payload: { name: "Gate 1 - Visitors Entry", gateType: "entry", areaId: AREA_HERE },
      });
      expect(res.statusCode).toBe(202);
      const id = (res.json() as { data: { id: string } }).data.id;
      await sleep(700);

      const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(gates).where(eq(gates.id, id))));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ locationId: LOCATION, name: "Gate 1 - Visitors Entry", gateType: "entry", areaId: AREA_HERE, active: true });

      const list = await app.inject({ method: "GET", url: `/v1/visitor/locations/${LOCATION}/gates`, headers: headers(["employee"]) });
      expect(list.statusCode).toBe(200);
      expect((list.json() as { data: Array<{ id: string }> }).data.map((g) => g.id)).toContain(id);
    } finally {
      await app.close();
    }
  });

  it("defaults to an active perimeter entry_exit gate", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: `/v1/visitor/locations/${LOCATION}/gates`, headers: admin(), payload: { name: "Main Gate" } });
      expect(res.statusCode).toBe(202);
      const id = (res.json() as { data: { id: string } }).data.id;
      await sleep(700);
      const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(gates).where(eq(gates.id, id))));
      expect(rows[0]).toMatchObject({ gateType: "entry_exit", areaId: null, active: true });
    } finally {
      await app.close();
    }
  });

  it("refuses bad input synchronously instead of a 202 that dead-letters", async () => {
    const app = await buildApp();
    try {
      const url = `/v1/visitor/locations/${LOCATION}/gates`;
      expect((await app.inject({ method: "POST", url, headers: admin(), payload: { name: "" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, headers: admin(), payload: { name: "G", gateType: "side" } })).statusCode).toBe(400);
      const wrongArea = await app.inject({ method: "POST", url, headers: admin(), payload: { name: "G", areaId: AREA_ELSEWHERE } });
      expect(wrongArea.statusCode).toBe(422);
      expect(JSON.stringify(wrongArea.json())).toContain("UNKNOWN_AREA");
      const unknownLoc = await app.inject({ method: "POST", url: `/v1/visitor/locations/${randomUUID()}/gates`, headers: admin(), payload: { name: "G" } });
      expect(unknownLoc.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("is admin-only for writes and tenant-scoped", async () => {
    const app = await buildApp();
    try {
      const url = `/v1/visitor/locations/${LOCATION}/gates`;
      expect((await app.inject({ method: "POST", url, headers: headers(["employee"]), payload: { name: "G" } })).statusCode).toBe(403);
      // a security admin of another tenant cannot see or write this tenant's location
      expect((await app.inject({ method: "POST", url, headers: headers(["security_admin"], OTHER_TENANT), payload: { name: "G" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url, headers: headers(["security_admin"], OTHER_TENANT) })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

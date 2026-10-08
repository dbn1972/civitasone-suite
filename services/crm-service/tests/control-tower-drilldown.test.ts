/**
 * GAP2-CRM-CONTROL-TOWER-07 — the aged-lead exception and the region/ageing
 * drill-downs must not point at /crm/dashboard, which shows none of the
 * drilled-into records.
 *
 * On the OLD code: the aged_lead exception href === "/crm/dashboard", and
 * drillDown.regionReport === drillDown.ageingReport === "/crm/dashboard" — all
 * dead drill-downs. This DB-backed HTTP test fails there and passes now.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-ct" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

type ControlTowerBody = {
  data: {
    exceptions: Array<{ id: string; kind: string; href: string }>;
    drillDown: { regionReport: string; ageingReport: string; accounts: string };
  };
};

async function fetchTower(): Promise<ControlTowerBody["data"]> {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/control-tower", headers: headers() });
  await app.close();
  expect(res.statusCode).toBe(200);
  return (res.json() as ControlTowerBody).data;
}

afterAll(async () => {
  await sqlClient.end();
});

beforeAll(async () => {
  // No seed needed: the route returns the exception/drillDown scaffold with
  // zero counts for an empty tenant, which is all this contract test inspects.
});

describe("control-tower drill-downs (GAP2-CRM-CONTROL-TOWER-07)", () => {
  it("the aged-lead exception no longer points at /crm/dashboard", async () => {
    const data = await fetchTower();
    const aged = data.exceptions.find((e) => e.kind === "aged_lead");
    expect(aged).toBeDefined();
    expect(aged!.href).not.toBe("/crm/dashboard");
    // The affordance is dropped until a real aged-lead view exists: an empty
    // href makes the web ExceptionTable render a disabled "Open".
    expect(aged!.href).toBe("");
  });

  it("the region/ageing drill-downs no longer point at /crm/dashboard", async () => {
    const data = await fetchTower();
    expect(data.drillDown.regionReport).not.toBe("/crm/dashboard");
    expect(data.drillDown.ageingReport).not.toBe("/crm/dashboard");
    // regionReport lands on the real "Pipeline by region" table (this screen).
    expect(data.drillDown.regionReport).toBe("/crm/control-tower");
    // ageingReport has no real view yet, so it is empty rather than a dead link.
    expect(data.drillDown.ageingReport).toBe("");
  });

  it("the overdue follow-up link still points at a real filtered segment", async () => {
    const data = await fetchTower();
    const overdue = data.exceptions.find((e) => e.kind === "overdue_follow_up");
    expect(overdue!.href).toBe("/crm/activities?segment=Overdue");
  });
});

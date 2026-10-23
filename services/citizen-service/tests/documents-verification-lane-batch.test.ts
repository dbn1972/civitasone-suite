/**
 * POST /v1/citizen/documents/verification-lane/batch: the officer task inbox
 * resolves every visible row's lane checklist in ONE request instead of one GET
 * per row. DB-backed; entries are answered independently (an unknown application
 * is ok:false, never a whole-batch failure); citizens are refused; the batch is capped.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0c00001-0000-4000-8000-000000000001";
const URL = "/v1/citizen/documents/verification-lane/batch";

function hdr(roles: string[]) {
  const t = signToken({ sub: randomUUID(), tid: TENANT, roles, sid: `sess-${randomUUID()}` }, SECRET, 3600);
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

afterAll(async () => { await sqlClient.end(); });

describe("verification-lane batch", () => {
  it("answers each lane independently: an unknown application is ok:false, the batch is still 200", async () => {
    const app = await buildApp();
    const a = randomUUID();
    const b = randomUUID();
    const res = await app.inject({
      method: "POST", url: URL, headers: hdr(["citizen_officer"]),
      payload: { lanes: [{ laneKey: "inspection", applicationId: a }, { laneKey: "inspection", applicationId: b }, { laneKey: "inspection", applicationId: a }] },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ applicationId: string; ok: boolean; items: unknown[] }>;
    // the duplicate (inspection, a) lookup is collapsed
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.applicationId).sort()).toEqual([a, b].sort());
    expect(data.every((d) => d.ok === false && d.items.length === 0)).toBe(true);
    await app.close();
  });

  it("refuses a citizen (officer roles only)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: URL, headers: hdr(["citizen"]), payload: { lanes: [{ laneKey: "inspection", applicationId: randomUUID() }] } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("validates the body: laneKey required, an id required, at most 50 lanes", async () => {
    const app = await buildApp();
    const h = hdr(["citizen_officer"]);
    const noId = await app.inject({ method: "POST", url: URL, headers: h, payload: { lanes: [{ laneKey: "inspection" }] } });
    expect(noId.statusCode).toBe(400);
    const noLane = await app.inject({ method: "POST", url: URL, headers: h, payload: { lanes: [{ applicationId: randomUUID() }] } });
    expect(noLane.statusCode).toBe(400);
    const empty = await app.inject({ method: "POST", url: URL, headers: h, payload: { lanes: [] } });
    expect(empty.statusCode).toBe(400);
    const tooMany = await app.inject({ method: "POST", url: URL, headers: h, payload: { lanes: Array.from({ length: 51 }, () => ({ laneKey: "inspection", applicationId: randomUUID() })) } });
    expect(tooMany.statusCode).toBe(400);
    await app.close();
  });
});

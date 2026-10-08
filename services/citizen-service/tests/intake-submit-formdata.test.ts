/**
 * GAP-CITIZEN-INTAKE-01 — the intake draft→submit path can no longer hand an
 * empty draft a tracking number (DB-backed). Decision: the draft+track flow is
 * RETAINED and HARDENED (not retired) — the server now fails closed on empty
 * formData at submit, so no acknowledgement is issued without answers.
 *
 * Fails on the old code: submit accepted any draft regardless of formData.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { hasFormAnswers } from "../src/modules/application/intake-domain.js";
import type { FastifyInstance } from "fastify";

registerApplicationConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "117a7e00-0000-4000-8000-000000000001";
const CITIZEN = "117a7e00-0000-4000-8000-0000000000c1";
const SERVICE = "117a7e00-0000-4000-8000-0000000000a1";

function tok() { return signToken({ sub: CITIZEN, tid: TENANT, roles: ["citizen"], sid: "sess-intake01" }, SECRET, 3600); }
function hdr() { return { authorization: `Bearer ${tok()}`, "content-type": "application/json", "x-tenant-id": TENANT }; }

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function draftId(id: string): Promise<{ id: string } | null> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT id FROM application.application_drafts WHERE id = ${id} AND tenant_id = ${TENANT}`;
  });
  return (rows[0] as { id: string } | undefined) ?? null;
}

describe("GAP-CITIZEN-INTAKE-01 — hasFormAnswers (pure)", () => {
  it("empty / non-object / blank is not submittable", () => {
    expect(hasFormAnswers({})).toBe(false);
    expect(hasFormAnswers(null)).toBe(false);
    expect(hasFormAnswers(undefined)).toBe(false);
    expect(hasFormAnswers({ a: "" , b: null })).toBe(false);
  });
  it("at least one real answer is submittable", () => {
    expect(hasFormAnswers({ name: "Asha" })).toBe(true);
    expect(hasFormAnswers({ age: 42 })).toBe(true);
  });
});

describe("GAP-CITIZEN-INTAKE-01 — submit fails closed on empty formData (DB-backed)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  it("rejects submit of an empty draft with 422 (no tracking number issued)", async () => {
    const save = await app.inject({
      method: "POST", url: "/v1/citizen/intake/drafts", headers: hdr(),
      payload: { serviceId: SERVICE, channel: "portal" },
    });
    expect(save.statusCode).toBe(202);
    const id = save.json().id as string;
    await waitFor(() => draftId(id));
    const submit = await app.inject({ method: "POST", url: `/v1/citizen/intake/drafts/${id}/submit`, headers: hdr(), payload: {} });
    expect(submit.statusCode).toBe(422);
    expect(submit.json().code).toBe("FORM_DATA_REQUIRED");
  });

  it("accepts submit once the draft has form answers (track still works)", async () => {
    const save = await app.inject({
      method: "POST", url: "/v1/citizen/intake/drafts", headers: hdr(),
      payload: { serviceId: SERVICE, channel: "portal", formData: { full_name: "Asha Devi" } },
    });
    const id = save.json().id as string;
    await waitFor(() => draftId(id));
    const submit = await app.inject({ method: "POST", url: `/v1/citizen/intake/drafts/${id}/submit`, headers: hdr(), payload: {} });
    expect(submit.statusCode).toBe(202);
    const trackingNo = submit.json().trackingNo as string;
    expect(trackingNo).toMatch(/^CIT-/);
    const track = await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/citizen/intake/track/${encodeURIComponent(trackingNo)}`, headers: hdr() });
      return r.statusCode === 200 ? r.json() : null;
    });
    expect(track.trackingNo).toBe(trackingNo);
  });
});

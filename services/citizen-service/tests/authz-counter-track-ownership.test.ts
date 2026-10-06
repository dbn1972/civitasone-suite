/**
 * GAP-CITIZEN-SERVICES-SERVICEKEY-02 (counter-channel operator authz) and
 * GAP-...-TRACK-TRACKINGNO-02 (tracking ownership / enumeration, DPDP).
 *
 * The audit snapshot marked both "service absent / cannot-verify". The backend
 * IS present in this worktree, so these are verified and PINNED server-side:
 *   SERVICES-02: a plain citizen cannot submit channel=counter — assisted/counter
 *     intake requires an officer-tier operator (403 FORBIDDEN); an officer with an
 *     operatorId succeeds and the operator is attributed on the draft.
 *   TRACK-02: GET /intake/track/:no is scoped to the owning citizen — citizen B
 *     requesting citizen A's tracking number gets 404 (existence not leaked);
 *     the owner gets 200. Tracking numbers are random (CIT-YYYY-8hex), not
 *     sequential, so they are not trivially enumerable.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import * as catalogueRepo from "../src/modules/catalogue/repo.js";

registerApplicationConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a2a2a2a2-0000-4000-8000-000000000055";
const CITIZEN_A = "aaaaaaaa-0000-4000-8000-000000000055";
const CITIZEN_B = "bbbbbbbb-0000-4000-8000-000000000055";
const OFFICER = "cccccccc-0000-4000-8000-000000000055";
const SYSTEM = "11111111-0000-4000-8000-000000000055";
const SERVICE_ID = "33333333-0000-4000-8000-000000000055";
const SERVICE_KEY = `authz-counter-${Date.now().toString(36)}`;
const DEF_ID = randomUUID();

function tok(actor: string, roles: string[]) {
  return signToken({ sub: actor, tid: TENANT, roles, sid: "sess-authz" }, SECRET, 3600);
}
function hdr(t: string) {
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}
async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

describe("citizen intake authz (SERVICES-02 counter / TRACK-02 ownership)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await catalogueRepo.insertDefinition(tx, {
          id: DEF_ID,
          tenantId: TENANT,
          serviceKey: SERVICE_KEY,
          serviceId: SERVICE_ID,
          name: "Authz Counter+Portal",
          servicePattern: "certificate",
          ownerDepartment: "Licensing",
          version: 1,
          status: "published",
          channels: ["portal", "counter"],
          requiredDocuments: [{ docType: "id_proof", label: "ID", mandatory: true }],
          forms: [],
          outputs: [],
          statutoryReferences: [],
          slaDays: 7,
          publishedBy: SYSTEM,
          publishedAt: new Date(),
          createdBy: SYSTEM,
          updatedBy: SYSTEM,
        });
      });
    });
  });

  afterAll(async () => {
    await app.close();
    await sqlClient.end();
  });

  it("SERVICES-02: a plain citizen submitting channel=counter is rejected (403, officer required)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/intake/drafts",
      headers: hdr(tok(CITIZEN_A, ["citizen"])),
      payload: { serviceId: SERVICE_ID, serviceKey: SERVICE_KEY, channel: "counter", formData: { name: "Asha" } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("SERVICES-02: an officer may submit channel=counter and the operator is attributed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/intake/drafts",
      headers: hdr(tok(OFFICER, ["citizen_officer"])),
      payload: {
        serviceId: SERVICE_ID,
        serviceKey: SERVICE_KEY,
        channel: "counter",
        citizenId: CITIZEN_A,
        operatorId: OFFICER,
        formData: { name: "Asha" },
        documentTypes: ["id_proof"],
      },
    });
    expect(res.statusCode).toBe(202);
    const draftId = res.json().id as string;
    const draft = await waitFor(async () => {
      const g = await app.inject({
        method: "GET",
        url: `/v1/citizen/intake/drafts/${draftId}`,
        headers: hdr(tok(OFFICER, ["citizen_officer"])),
      });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(draft.channel).toBe("counter");
    expect(draft.assistedBy).toBe(OFFICER);
  });

  it("TRACK-02: citizen B cannot read citizen A's tracking number (404, existence not leaked)", async () => {
    // Citizen A submits a portal application and gets a tracking number.
    const create = await app.inject({
      method: "POST",
      url: "/v1/citizen/intake/drafts",
      headers: hdr(tok(CITIZEN_A, ["citizen"])),
      payload: {
        serviceId: SERVICE_ID,
        serviceKey: SERVICE_KEY,
        channel: "portal",
        formData: { name: "Asha" },
        documentTypes: ["id_proof"],
      },
    });
    expect(create.statusCode).toBe(202);
    const draftId = create.json().id as string;

    // CQRS: wait for the consumer to persist the draft before submitting.
    await waitFor(async () => {
      const g = await app.inject({
        method: "GET",
        url: `/v1/citizen/intake/drafts/${draftId}`,
        headers: hdr(tok(CITIZEN_A, ["citizen"])),
      });
      return g.statusCode === 200 ? g.json() : null;
    });

    const submit = await app.inject({
      method: "POST",
      url: `/v1/citizen/intake/drafts/${draftId}/submit`,
      headers: hdr(tok(CITIZEN_A, ["citizen"])),
      payload: {},
    });
    expect(submit.statusCode).toBe(202);
    const trackingNo = submit.json().trackingNo as string;
    expect(trackingNo).toMatch(/^CIT-\d{4}-[0-9A-F]{8}$/); // random, non-sequential

    // Owner (A) can read it.
    const owner = await waitFor(async () => {
      const g = await app.inject({
        method: "GET",
        url: `/v1/citizen/intake/track/${encodeURIComponent(trackingNo)}`,
        headers: hdr(tok(CITIZEN_A, ["citizen"])),
      });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(owner.trackingNo).toBe(trackingNo);

    // Citizen B must NOT be able to read it — 404, not 200/403 (no existence leak).
    const other = await app.inject({
      method: "GET",
      url: `/v1/citizen/intake/track/${encodeURIComponent(trackingNo)}`,
      headers: hdr(tok(CITIZEN_B, ["citizen"])),
    });
    expect(other.statusCode).toBe(404);
    expect(other.json().code).toBe("NOT_FOUND");
  });
});

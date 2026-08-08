/**
 * FN-24 — channel enforcement at citizen intake.
 * Acceptance: a published portal-only service rejects mobile submission with a clear error.
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
const TENANT = "a1a1a1a1-0000-4000-8000-000000000024";
const CITIZEN = "55555555-0000-4000-8000-000000000024";
const SYSTEM = "11111111-0000-4000-8000-000000000024";
const SERVICE_ID = "33333333-0000-4000-8000-000000000024";
const SERVICE_KEY = `fn24-portal-only-${Date.now().toString(36)}`;
const DEF_ID = randomUUID();

function tok(actor: string, roles = ["citizen"]) {
  return signToken({ sub: actor, tid: TENANT, roles, sid: "sess-fn24" }, SECRET, 3600);
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

describe("FN-24 channel enforcement at intake", () => {
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
          name: "FN-24 Portal Only",
          servicePattern: "certificate",
          ownerDepartment: "Licensing",
          version: 1,
          status: "published",
          channels: ["portal"],
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

  it("rejects mobile draft on a portal-only published service with CHANNEL_NOT_ALLOWED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/intake/drafts",
      headers: hdr(tok(CITIZEN)),
      payload: {
        serviceId: SERVICE_ID,
        serviceKey: SERVICE_KEY,
        channel: "mobile",
        formData: { name: "Asha" },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CHANNEL_NOT_ALLOWED");
    expect(res.json().message).toMatch(/mobile/i);
    expect(res.json().message).toMatch(/portal/i);
  });

  it("rejects mobile draft when serviceId is the published definition row id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/intake/drafts",
      headers: hdr(tok(CITIZEN)),
      payload: {
        serviceId: DEF_ID,
        serviceKey: SERVICE_KEY,
        channel: "mobile",
        formData: {},
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CHANNEL_NOT_ALLOWED");
  });

  it("accepts portal draft and submit on the same portal-only service", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/intake/drafts",
      headers: hdr(tok(CITIZEN)),
      payload: {
        serviceId: SERVICE_ID,
        serviceKey: SERVICE_KEY,
        channel: "portal",
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
        headers: hdr(tok(CITIZEN)),
      });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(draft.channel).toBe("portal");

    const submit = await app.inject({
      method: "POST",
      url: `/v1/citizen/intake/drafts/${draftId}/submit`,
      headers: hdr(tok(CITIZEN)),
      payload: {},
    });
    expect(submit.statusCode).toBe(202);
    expect(submit.json().channel).toBe("portal");
  });
});

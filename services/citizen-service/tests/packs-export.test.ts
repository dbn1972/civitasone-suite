/**
 * FN-09 / FN-29 — export published catalogue → versioned pack; statutory ack on import.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPacksConsumers } from "../src/modules/packs/consumer.js";
import { registerCatalogueConsumers } from "../src/modules/catalogue/consumer.js";
import type { FastifyInstance } from "fastify";
import type { ServiceDefinitionRow } from "../src/modules/catalogue/schema.js";
import type { ServicePackRow } from "../src/modules/packs/schema.js";

registerPacksConsumers(queue);
registerCatalogueConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c3c3c3c3-0000-4000-8000-000000000029";
const MAKER = "11111111-0000-4000-8000-000000000029";
const CHECKER = "22222222-0000-4000-8000-000000000029";
const SERVICE_KEY = `hall-booking-export-${Date.now().toString(36)}`;

function tok(actor: string) {
  return signToken(
    { sub: actor, tid: TENANT, roles: ["citizen_admin", "citizen_officer", "super_admin"], sid: "sess-pack-export" },
    SECRET,
    3600,
  );
}
function hdr(actor: string) {
  return { authorization: `Bearer ${tok(actor)}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); }, 30000);
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("FN-09 pack export / FN-29 statutory import ack", () => {
  let definitionId: string;
  let packId: string;

  it("publishes a fee-bearing certificate definition", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/citizen/catalogue/services",
      headers: hdr(MAKER),
      payload: {
        serviceKey: SERVICE_KEY,
        name: "Community Hall Booking",
        servicePattern: "certificate",
        ownerDepartment: "Estate",
        channels: ["portal"],
        slaDays: 7,
        feeModel: "flat",
        hoaCode: "4301",
        formId: "eeeeeeee-0001-4000-8000-000000000001",
        eligibilityRuleSetId: "eeeeeeee-0002-4000-8000-000000000001",
        workflowDefinitionId: "eeeeeeee-0003-4000-8000-000000000001",
        feeScheduleId: "eeeeeeee-0004-4000-8000-000000000001",
        issuanceType: "certificate",
        requiredDocuments: [{ docType: "id_proof", label: "ID proof", mandatory: true }],
        statutoryReferences: [{ act: "Municipal Premises Rules", section: "4" }],
        forms: [{
          formDesign: {
            sections: [{ id: "s1", label: "Details", fieldIds: ["f1"] }],
            fields: {
              f1: { id: "f1", apiName: "purpose", type: "text", label: "Purpose", required: true, sectionId: "s1" },
            },
          },
          runtimeMeta: { description: "Hall booking", feeFromMinor: 250000, feeCurrency: "INR" },
        }],
        outputs: [{ type: "certificate", templateKey: "hall-booking" }],
      },
    });
    expect(create.statusCode).toBe(202);
    definitionId = (create.json() as { id: string }).id;

    await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: `/v1/citizen/catalogue/services/${definitionId}`, headers: hdr(MAKER),
      });
      if (g.statusCode !== 200) return null;
      const body = g.json() as ServiceDefinitionRow;
      return body.formId && body.workflowDefinitionId && body.feeScheduleId && body.hoaCode
        ? body
        : null;
    });

    const sandbox = await app.inject({
      method: "POST",
      url: `/v1/citizen/catalogue/services/${definitionId}/sandbox-test/run`,
      headers: hdr(MAKER),
      payload: {},
    });
    expect(sandbox.statusCode).toBe(200);
    expect((sandbox.json() as { passed: boolean }).passed).toBe(true);

    const submit = await app.inject({
      method: "POST", url: `/v1/citizen/catalogue/services/${definitionId}/submit`, headers: hdr(MAKER), payload: {},
    });
    expect(submit.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: `/v1/citizen/catalogue/services/${definitionId}`, headers: hdr(MAKER),
      });
      return g.json().submittedBy ? g.json() : null;
    });

    const publish = await app.inject({
      method: "POST", url: `/v1/citizen/catalogue/services/${definitionId}/publish`, headers: hdr(CHECKER), payload: {},
    });
    expect(publish.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: `/v1/citizen/catalogue/services/${definitionId}`, headers: hdr(CHECKER),
      });
      return g.json().status === "published" ? g.json() : null;
    });
  }, 30000);

  it("rejects export of a non-published definition", async () => {
    const draftCreate = await app.inject({
      method: "POST",
      url: "/v1/citizen/catalogue/services",
      headers: hdr(MAKER),
      payload: {
        serviceKey: `${SERVICE_KEY}-draft`,
        name: "Draft only",
        channels: ["portal"],
        requiredDocuments: [],
      },
    });
    const draftId = (draftCreate.json() as { id: string }).id;
    await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: `/v1/citizen/catalogue/services/${draftId}`, headers: hdr(MAKER),
      });
      return g.statusCode === 200 ? g.json() : null;
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/packs/services/export",
      headers: hdr(MAKER),
      payload: { definitionId: draftId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_PUBLISHED");
  }, 15000);

  it("exports published definition as a versioned service pack", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/packs/services/export",
      headers: hdr(MAKER),
      payload: { definitionId },
    });
    expect(res.statusCode).toBe(202);
    packId = (res.json() as { id: string }).id;

    const pack = await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: `/v1/citizen/packs/services/${packId}`, headers: hdr(MAKER),
      });
      return g.statusCode === 200 ? (g.json() as ServicePackRow) : null;
    });

    expect(pack.packKey).toContain("pack:hall-booking-export");
    expect(pack.status).toBe("published");
    expect(pack.serviceDefinitionId).toBe(definitionId);
    expect(pack.hoaCode).toBe("4301");
    expect(pack.statutoryReferences?.length).toBeGreaterThan(0);
    const manifest = pack.manifest as {
      schemaVersion?: string;
      blocks?: { formId?: string; feeFromMinor?: number };
      authorityScope?: string;
    };
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.blocks?.formId).toBe("eeeeeeee-0001-4000-8000-000000000001");
    expect(manifest.blocks?.feeFromMinor).toBe(250000);
    expect(manifest.authorityScope).toContain("Municipal Premises Rules");
  }, 15000);

  it("FN-29: import without statutory ack is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/packs/services/${packId}/import`,
      headers: hdr(MAKER),
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("STATUTORY_ACK_REQUIRED");
  });

  it("FN-09: import with ack clones as draft (never auto-publish)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/packs/services/${packId}/import`,
      headers: hdr(MAKER),
      payload: { acknowledgeStatutory: true },
    });
    expect(res.statusCode).toBe(202);
    const defId = (res.json() as { id: string }).id;

    const def = await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(MAKER),
      });
      return g.statusCode === 200 ? (g.json() as ServiceDefinitionRow) : null;
    });

    expect(def.status).toBe("draft");
    expect(def.formId).toBe("eeeeeeee-0001-4000-8000-000000000001");
    expect(def.feeScheduleId).toBe("eeeeeeee-0004-4000-8000-000000000001");
    expect(def.hoaCode).toBe("4301");
    expect(Array.isArray(def.forms) && def.forms.length > 0).toBe(true);
  }, 15000);
});

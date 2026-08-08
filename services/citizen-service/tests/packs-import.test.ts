/**
 * FN-09 / FN-10 — pack import applies manifest blocks; Trade License passes sandbox.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPacksConsumers } from "../src/modules/packs/consumer.js";
import { registerCatalogueConsumers } from "../src/modules/catalogue/consumer.js";
import { registerSandboxTestConsumers } from "../src/modules/sandbox-test/consumer.js";
import { runSandboxPipeline } from "../src/modules/sandbox-test/domain.js";
import { blocksFromManifest } from "../src/modules/packs/manifest-apply.js";
import { tradeLicensePackManifest } from "../src/modules/packs/manifests/trade-license.js";
import type { FastifyInstance } from "fastify";
import type { ServiceDefinitionRow } from "../src/modules/catalogue/schema.js";

registerPacksConsumers(queue);
registerCatalogueConsumers(queue);
registerSandboxTestConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ADMIN = "00000000-0000-0000-0000-000000000099";
const TL_PACK_ID = "bbbbbbbb-0001-4000-8000-000000000001";

function tok(actor = ADMIN) {
  return signToken({ sub: actor, tid: TENANT, roles: ["citizen_admin", "super_admin"], sid: "sess-packs" }, SECRET, 3600);
}
function hdr(t: string) {
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("Trade License pack manifest (FN-09/10)", () => {
  it("manifest blocks satisfy sandbox pipeline", () => {
    const blocks = blocksFromManifest("pack:trade-license", tradeLicensePackManifest());
    expect(blocks?.formId).toBeTruthy();
    expect(blocks?.forms?.length).toBeGreaterThan(0);

    const def = {
      id: "test",
      tenantId: TENANT,
      serviceKey: "trade-license-test",
      serviceId: null,
      name: "Trade License",
      ownerDepartment: null,
      servicePattern: "certificate" as const,
      ownerOfficeId: null,
      offeringOfficeIds: null,
      workflowDefinitionId: blocks!.workflowDefinitionId!,
      formId: blocks!.formId!,
      feeModel: blocks!.feeModel!,
      hoaCode: blocks!.hoaCode!,
      statutoryReferences: [],
      engineBindings: [],
      version: 1,
      status: "draft",
      eligibilityRuleSetId: blocks!.eligibilityRuleSetId!,
      feeScheduleId: blocks!.feeScheduleId!,
      issuanceType: blocks!.issuanceType!,
      requiredDocuments: blocks!.requiredDocuments ?? [],
      laneBindings: blocks!.laneBindings ?? [],
      slaDays: blocks!.slaDays ?? 15,
      channels: ["portal"],
      forms: blocks!.forms ?? [],
      outputs: blocks!.outputs ?? [],
      allowedApplicantTypes: ["citizen"],
      applicantTypeRejectMessage: null,
      profileAttributeBindings: [],
      submittedBy: null,
      publishedBy: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ADMIN,
      updatedBy: ADMIN,
      rowVersion: 1,
    } satisfies ServiceDefinitionRow;

    const result = runSandboxPipeline(def);
    expect(result.passed).toBe(true);
  });

  it("imports municipal-in-v1 Trade License pack as wired draft", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/packs/services/${TL_PACK_ID}/import`,
      headers: hdr(tok()),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const { id: defId } = res.json() as { id: string };

    const def = await waitFor(async () => {
      const g = await app.inject({
        method: "GET",
        url: `/v1/citizen/catalogue/services/${defId}`,
        headers: hdr(tok()),
      });
      return g.statusCode === 200 ? (g.json() as ServiceDefinitionRow) : null;
    });

    expect(def.formId).toBeTruthy();
    expect(def.eligibilityRuleSetId).toBeTruthy();
    expect(def.workflowDefinitionId).toBeTruthy();
    expect(def.feeScheduleId).toBeTruthy();
    expect(Array.isArray(def.forms) && def.forms.length > 0).toBe(true);

    const sandbox = runSandboxPipeline(def);
    expect(sandbox.passed).toBe(true);
  });
});

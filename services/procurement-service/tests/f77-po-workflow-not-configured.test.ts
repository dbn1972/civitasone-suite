/**
 * F77: a PO is only ever approved through its `procurement_po_approval`
 * workflow task. In a tenant without that definition, POST /pos used to answer
 * 202 and workflow-service then rejected the approval instance
 * (unknown_definition), leaving the PO in draft forever. The create routes now
 * ask workflow-service first and refuse with 422 WORKFLOW_NOT_CONFIGURED,
 * enqueuing nothing. If workflow-service cannot be asked, the PO is still
 * accepted (the async path stays fail-closed).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";

const TENANT = "11111111-eeee-4000-8000-0000000000f7";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const headers = { authorization: `Bearer ${signToken({ sub: "u-f77", tid: TENANT, roles: ["procurement_officer"], sid: "s-f77" }, SECRET)}` };
const VENDOR = randomUUID();

function poBody() {
  return {
    vendorId: VENDOR, indentRef: `procurement_indent:${randomUUID()}`,
    gemOrderRef: "GEM/TEST/BASIS", // D4c #28: no empanelment record -> needs a GeM/tender basis
    items: [{ itemCode: "IC-1", description: "Widget", quantity: 1, unit: "nos", unitPriceMinor: 100 }],
  };
}

const realFetch = globalThis.fetch;
/** Answer workflow-service's definition-configured pre-check; record what was asked. */
function mockWorkflow(answer: "configured" | "missing" | "down") {
  const asked: Array<{ tenant: string | null; code: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/v1/workflow/internal/definition-configured")) return realFetch(input, init);
    const h = new Headers(init?.headers);
    asked.push({ tenant: h.get("x-tenant-id"), code: JSON.parse(String(init?.body)).code });
    if (answer === "down") throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ code: "procurement_po_approval", configured: answer === "configured" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  return asked;
}

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({ id: VENDOR, tenantId: TENANT, name: "F77 Co", vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("F77 — PO create pre-checks the PO approval workflow definition", () => {
  for (const url of ["/v1/procurement/pos", "/v1/procurement/purchase-orders"]) {
    it(`${url}: 422 WORKFLOW_NOT_CONFIGURED and nothing enqueued when the tenant has no procurement_po_approval`, async () => {
      const asked = mockWorkflow("missing");
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url, headers, payload: poBody() });
      await app.close();
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("WORKFLOW_NOT_CONFIGURED");
      expect(res.json().message).toContain("procurement_po_approval");
      expect(publish).not.toHaveBeenCalled();
      expect(asked).toEqual([{ tenant: TENANT, code: "procurement_po_approval" }]);
    });
  }

  it("202 and the command is enqueued when the definition is configured", async () => {
    mockWorkflow("configured");
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers, payload: poBody() });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("fails open (202) when workflow-service cannot be asked", async () => {
    mockWorkflow("down");
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers, payload: poBody() });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

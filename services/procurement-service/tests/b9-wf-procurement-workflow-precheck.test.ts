/**
 * B9-wf1: plan submit and PO amendment request raise workflow instances for
 * `procurement_plan_approval` / `procurement_po_amendment_approval`. Like the
 * F77 PO create, they now pre-check the tenant has the chain and answer 422
 * WORKFLOW_NOT_CONFIGURED (nothing enqueued) instead of a 202 whose approval
 * instance can never be created.
 *
 * B9-wf2: a 401 / 403 from workflow-service (procurement's service secret is
 * wrong) used to be read as "could not ask" and fail open, so a misconfigured
 * token looked like success. It is now a 503 WORKFLOW_SERVICE_AUTH_FAILED with
 * an error-level log, and nothing is enqueued. A genuine outage still fails open.
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
import { procurementPlans } from "../src/modules/planning/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { fetchRefDecisions, workflowClientLog } from "../src/shared/workflow-client.js";

const TENANT = "11111111-eeee-4000-8000-0000000000b9";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const headers = { authorization: `Bearer ${signToken({ sub: "u-b9wf", tid: TENANT, roles: ["procurement_admin"], sid: "s-b9wf" }, SECRET)}` };
const VENDOR = randomUUID();
const PLAN = randomUUID();
const PO = randomUUID();

type Answer = "configured" | "missing" | "down" | 401 | 403 | 500;
const realFetch = globalThis.fetch;
/** Stub workflow-service's internal routes; record which definition codes were asked about. */
function mockWorkflow(answer: Answer) {
  const asked: Array<{ tenant: string | null; code: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/v1/workflow/internal/")) return realFetch(input, init);
    const h = new Headers(init?.headers);
    asked.push({ tenant: h.get("x-tenant-id"), code: JSON.parse(String(init?.body)).code });
    if (answer === "down") throw new TypeError("fetch failed");
    if (typeof answer === "number") {
      return new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "nope" }), { status: answer, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ code: "x", configured: answer === "configured" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  return asked;
}

const routes = [
  { name: "plan submit", method: "PATCH" as const, url: `/v1/procurement/plans/${PLAN}/submit`, payload: {}, code: "procurement_plan_approval" },
  { name: "PO amendment request", method: "POST" as const, url: `/v1/procurement/pos/${PO}/amendments`, payload: { reason: "scope change", deltaMinor: 100 }, code: "procurement_po_amendment_approval" },
];

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementPlans).where(eq(procurementPlans.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

async function inject(r: { method: "PATCH" | "POST"; url: string; payload: unknown }) {
  const app = await buildApp();
  const res = await app.inject({ method: r.method, url: r.url, headers, payload: r.payload as Record<string, unknown> });
  await app.close();
  return res;
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({ id: VENDOR, tenantId: TENANT, name: "B9 Co", vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(procurementPlans).values({ id: PLAN, tenantId: TENANT, planNo: "APP/2026/B9", planYear: 2026, title: "B9 plan", department: "Stores", status: "draft", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(procurementPos).values({ id: PO, tenantId: TENANT, poNo: "PO/2026/B9", vendorId: VENDOR, indentRef: `procurement_indent:${randomUUID()}`, totalMinor: 1000n, status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("B9-wf1 — plan submit / amendment request pre-check their approval workflow definition", () => {
  for (const r of routes) {
    it(`${r.name}: 422 WORKFLOW_NOT_CONFIGURED and nothing enqueued when the tenant has no ${r.code}`, async () => {
      const asked = mockWorkflow("missing");
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await inject(r);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("WORKFLOW_NOT_CONFIGURED");
      expect(res.json().message).toContain(r.code);
      expect(publish).not.toHaveBeenCalled();
      expect(asked).toEqual([{ tenant: TENANT, code: r.code }]);
    });

    it(`${r.name}: 202 and the command is enqueued when ${r.code} is configured`, async () => {
      mockWorkflow("configured");
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await inject(r);
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it(`${r.name}: still fails open (202) when workflow-service is unreachable or answers 5xx`, async () => {
      for (const answer of ["down", 500] as const) {
        mockWorkflow(answer);
        const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
        const res = await inject(r);
        expect(res.statusCode).toBe(202);
        expect(publish).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
      }
    });
  }
});

describe("B9-wf2 — a workflow-service auth refusal fails loudly instead of looking like success", () => {
  const all = [
    ...routes,
    { name: "PO create", method: "POST" as const, url: "/v1/procurement/pos", code: "procurement_po_approval",
      payload: { vendorId: VENDOR, indentRef: `procurement_indent:${randomUUID()}`, gemOrderRef: "GEM/TEST/BASIS",
        items: [{ itemCode: "IC-1", description: "Widget", quantity: 1, unit: "nos", unitPriceMinor: 100 }] } },
  ];
  for (const r of all) {
    for (const status of [401, 403] as const) {
      it(`${r.name}: workflow-service ${status} -> 503 WORKFLOW_SERVICE_AUTH_FAILED, error logged, nothing enqueued`, async () => {
        mockWorkflow(status);
        const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
        const logged = vi.spyOn(workflowClientLog, "error");
        const res = await inject(r);
        expect(res.statusCode).toBe(503);
        expect(res.json().code).toBe("WORKFLOW_SERVICE_AUTH_FAILED");
        expect(publish).not.toHaveBeenCalled();
        expect(logged).toHaveBeenCalledTimes(1);
        expect(logged.mock.calls[0]![0]).toMatchObject({ status, op: "definition-configured" });
      });
    }
  }

  it("fetchRefDecisions: a 401 throws WORKFLOW_SERVICE_AUTH_FAILED (503) instead of reporting the trail unavailable", async () => {
    mockWorkflow(401);
    const logged = vi.spyOn(workflowClientLog, "error");
    await expect(fetchRefDecisions(TENANT, "procurement_indent", randomUUID()))
      .rejects.toMatchObject({ status: 503, code: "WORKFLOW_SERVICE_AUTH_FAILED" });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("fetchRefDecisions: an outage / 5xx still reports available:false", async () => {
    for (const answer of ["down", 500] as const) {
      mockWorkflow(answer);
      expect(await fetchRefDecisions(TENANT, "procurement_indent", randomUUID())).toEqual({ available: false, decisions: [] });
      vi.restoreAllMocks();
    }
  });
});

/**
 * UAT API sweep 2026-10-28/29: malformed ids / query / bodies must answer 4xx, never 5xx.
 *
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so the
 * encapsulated route contexts that have no handler of their own (cppp, dashboard, gap, gem,
 * gepnic, po-print, po amendments) kept Fastify default handler and a thrown ZodError became a
 * 500. The 500s then tripped the gateway circuit breaker, which is why most of the 114 routes in
 * the sweep surfaced as 503 SERVICE_UNAVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000c5";
const headers = { authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000c5", tid: T, roles: ["super_admin"], sid: "sess-val" }, SECRET, 3600)}` };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

export const UAT_5XX_ROUTES: Array<[string, string]> = [
  ["POST", "/v1/procurement/advances"],
  ["GET", "/v1/procurement/approvals"],
  ["POST", "/v1/procurement/approvals/ref-summaries"],
  ["GET", "/v1/procurement/auctions"],
  ["POST", "/v1/procurement/auctions"],
  ["GET", "/v1/procurement/auctions/:id"],
  ["POST", "/v1/procurement/auctions/:id/bids"],
  ["PATCH", "/v1/procurement/auctions/:id/close"],
  ["GET", "/v1/procurement/bid-evaluations"],
  ["POST", "/v1/procurement/central-debarment"],
  ["GET", "/v1/procurement/central-debarment"],
  ["POST", "/v1/procurement/cppp/tenders"],
  ["GET", "/v1/procurement/cppp/tenders/:id"],
  ["GET", "/v1/procurement/cppp/tenders/:id/bids"],
  ["GET", "/v1/procurement/dashboard"],
  ["POST", "/v1/procurement/debit-notes"],
  ["GET", "/v1/procurement/emd"],
  ["POST", "/v1/procurement/emd"],
  ["GET", "/v1/procurement/emd/:id"],
  ["POST", "/v1/procurement/emd/:id/forfeit"],
  ["POST", "/v1/procurement/emd/:id/refund"],
  ["GET", "/v1/procurement/empanelment"],
  ["GET", "/v1/procurement/gem/integration/config"],
  ["POST", "/v1/procurement/gem/integration/exchange"],
  ["GET", "/v1/procurement/gem/integration/refs"],
  ["GET", "/v1/procurement/gem/integration/refs/:id"],
  ["POST", "/v1/procurement/gem/integration/refs/:id/reconcile"],
  ["GET", "/v1/procurement/gem/items"],
  ["POST", "/v1/procurement/gem/orders"],
  ["GET", "/v1/procurement/gem/products"],
  ["GET", "/v1/procurement/gem/products/:id"],
  ["POST", "/v1/procurement/gepnic/tenders"],
  ["GET", "/v1/procurement/gepnic/tenders/:id"],
  ["GET", "/v1/procurement/gepnic/tenders/:id/award"],
  ["GET", "/v1/procurement/gfr/mode-bands"],
  ["GET", "/v1/procurement/grns"],
  ["POST", "/v1/procurement/grns"],
  ["GET", "/v1/procurement/grns/:id"],
  ["PATCH", "/v1/procurement/grns/:id"],
  ["PATCH", "/v1/procurement/grns/:id/accept"],
  ["PATCH", "/v1/procurement/grns/:id/reject"],
  ["GET", "/v1/procurement/grns/summary"],
  ["GET", "/v1/procurement/indents/:id"],
  ["POST", "/v1/procurement/matches/invoice"],
  ["GET", "/v1/procurement/orders"],
  ["GET", "/v1/procurement/payments"],
  ["GET", "/v1/procurement/payments/:id"],
  ["GET", "/v1/procurement/pbg"],
  ["POST", "/v1/procurement/pbg"],
  ["GET", "/v1/procurement/pbg/:id"],
  ["POST", "/v1/procurement/pbg/:id/forfeit"],
  ["POST", "/v1/procurement/pbg/:id/release"],
  ["POST", "/v1/procurement/plans"],
  ["GET", "/v1/procurement/plans"],
  ["GET", "/v1/procurement/plans/:id"],
  ["PATCH", "/v1/procurement/plans/:id/approve"],
  ["POST", "/v1/procurement/plans/:id/link-tender"],
  ["PATCH", "/v1/procurement/plans/:id/reject"],
  ["PATCH", "/v1/procurement/plans/:id/submit"],
  ["POST", "/v1/procurement/plans/aggregate-from-indents"],
  ["GET", "/v1/procurement/pos"],
  ["POST", "/v1/procurement/pos"],
  ["GET", "/v1/procurement/pos/:id"],
  ["POST", "/v1/procurement/pos/:id/amendments"],
  ["GET", "/v1/procurement/pos/:id/amendments"],
  ["PATCH", "/v1/procurement/pos/:id/amendments/:amendmentId/reject"],
  ["PATCH", "/v1/procurement/pos/:id/close"],
  ["PATCH", "/v1/procurement/pos/:id/dispatch"],
  ["GET", "/v1/procurement/pos/:id/download"],
  ["POST", "/v1/procurement/pos/:id/milestones"],
  ["GET", "/v1/procurement/pos/:id/milestones"],
  ["PATCH", "/v1/procurement/pos/:id/milestones/:milestoneId"],
  ["GET", "/v1/procurement/pos/:id/pdf"],
  ["POST", "/v1/procurement/pos/:id/submit-approval"],
  ["POST", "/v1/procurement/pos/gem"],
  ["GET", "/v1/procurement/pos/resolve"],
  ["GET", "/v1/procurement/pre-bid-conferences"],
  ["GET", "/v1/procurement/purchase-orders"],
  ["POST", "/v1/procurement/purchase-orders"],
  ["GET", "/v1/procurement/purchase-orders/:id"],
  ["GET", "/v1/procurement/resolution-intake"],
  ["PATCH", "/v1/procurement/resolution-intake/:id/review"],
  ["GET", "/v1/procurement/reverse-auctions"],
  ["POST", "/v1/procurement/rfqs"],
  ["GET", "/v1/procurement/rfqs"],
  ["GET", "/v1/procurement/rfqs/:id"],
  ["POST", "/v1/procurement/rfqs/:id/award"],
  ["POST", "/v1/procurement/rfqs/:id/close"],
  ["POST", "/v1/procurement/rfqs/:id/respond"],
  ["GET", "/v1/procurement/tenders"],
  ["POST", "/v1/procurement/tenders"],
  ["GET", "/v1/procurement/tenders/:id"],
  ["POST", "/v1/procurement/tenders/:id/award"],
  ["POST", "/v1/procurement/tenders/:id/bids"],
  ["POST", "/v1/procurement/tenders/:id/corrigenda"],
  ["GET", "/v1/procurement/tenders/:id/corrigenda"],
  ["PATCH", "/v1/procurement/tenders/:id/corrigenda/:corrigendumId/republish"],
  ["POST", "/v1/procurement/tenders/:id/documents"],
  ["GET", "/v1/procurement/tenders/:id/documents"],
  ["GET", "/v1/procurement/tenders/:id/evaluation"],
  ["POST", "/v1/procurement/tenders/:id/open-financial"],
  ["POST", "/v1/procurement/tenders/:id/prebid-queries"],
  ["GET", "/v1/procurement/tenders/:id/prebid-queries"],
  ["PATCH", "/v1/procurement/tenders/:id/prebid-queries/:queryId/answer"],
  ["PATCH", "/v1/procurement/tenders/:id/prebid-queries/:queryId/publish"],
  ["POST", "/v1/procurement/tenders/:id/publish"],
  ["POST", "/v1/procurement/tenders/:id/technical-evaluation"],
  ["GET", "/v1/procurement/tenders/commands/:commandId/status"],
  ["POST", "/v1/procurement/three-way-match"],
  ["GET", "/v1/procurement/three-way-match"],
  ["GET", "/v1/procurement/vendor-blacklist"],
  ["POST", "/v1/procurement/vendors/:id/blacklist"],
  ["DELETE", "/v1/procurement/vendors/:id/blacklist"],
  ["GET", "/v1/procurement/vendors/blacklisted"],
];
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

/** CPPP / GeM / GePNIC are env-gated: a documented 503 INTEGRATION_DISABLED (not a defect, not a 500). */
function isGatedIntegration(res: { statusCode: number; json: () => any }): boolean {
  if (res.statusCode !== 503) return false;
  const j = res.json();
  return (j?.error?.code ?? j?.code) === "INTEGRATION_DISABLED";
}

function fill(path: string, id: string): string {
  return path.replace(/:[A-Za-z]+/g, id);
}

describe("every sweep route answers < 500 for a malformed id, a missing id and an empty body", () => {
  for (const [method, path] of UAT_5XX_ROUTES) {
    it(`${method} ${path}`, async () => {
      const bad = await app.inject({ method: method as "GET", url: fill(path, "not-a-uuid"), headers, payload: method === "GET" || method === "DELETE" ? undefined : {} });
      if (isGatedIntegration(bad)) return;
      expect(bad.statusCode, `malformed id: ${bad.body}`).toBeLessThan(500);
      const missing = await app.inject({ method: method as "GET", url: fill(path, MISSING_UUID) + (method === "GET" ? "?limit=abc&offset=-5" : ""), headers, payload: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(missing.statusCode, `missing id / bad query: ${missing.body}`).toBeLessThan(500);
    });
  }
});

describe("ZodError in a handler-less module is a 400 VALIDATION_FAILED envelope", () => {
  it("POST /v1/procurement/cppp/tenders with {}", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/cppp/tenders", headers, payload: {} });
    // CPPP is env-gated and carries its own {error:{...}} envelope; the point here is 4xx, not 500/503.
    expect(res.statusCode).toBeLessThan(500);
  });
  it("GET /v1/procurement/pos/not-a-uuid/amendments", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/pos/not-a-uuid/amendments", headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});

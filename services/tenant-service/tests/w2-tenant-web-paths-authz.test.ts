/**
 * W2 tenant part 1 -- GAP-TENANT-{HOME-01, CODE-LISTS-04, DATA-MIGRATION-04,
 * ORG-HIERARCHY-04, OVERVIEW-05, PLANS-04, POSITIONS-04, QUOTAS-05,
 * SETTINGS-01, STEWARDSHIP-04, SUBSCRIPTIONS-04}.
 *
 * The /tenant web area loads exactly these gateway paths (apps/web tenant/_data.ts
 * -> /api/v1/tenant/<x>, forwarded verbatim as /v1/tenant/<x>). The older
 * governance-reads-authz test pins the canonical (non-/tenant) paths; this one
 * pins the SAME contract on the exact paths the web calls:
 *   basic signed-in user -> 403, tenant admin -> 200, no token -> 401.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;

function bearer(roles: string[], tid: string): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: randomUUID(), tid, roles, sid: "sess-w2-tn1" }, SECRET, 3600)}` };
}

afterAll(async () => {
  await sqlClient.end();
});

// `pass` is the least-privileged role that the endpoint gate admits.
const WEB_PATHS: Array<{ gap: string; url: string; pass: string; admitted?: number }> = [
  { gap: "QUOTAS-05 / HOME-01", url: "/v1/tenant/usage", pass: "tenant_admin" },
  { gap: "SETTINGS-01 / HOME-01", url: "/v1/tenant/settings", pass: "tenant_admin" },
  // PLANS-04 is deliberately NOT here: GET /v1/tenant/plans is the plan-comparison
  // catalogue, readable by any authenticated user by design (pinned by
  // subscription-upgrade.test.ts "GET /v1/tenant/plans"). Owner decision pending.
  // a throwaway tenant has no subscription row, so the admitted admin sees 404 (not 403).
  { gap: "SUBSCRIPTIONS-04", url: "/v1/tenant/subscription/current", pass: "tenant_admin", admitted: 404 },
  { gap: "CODE-LISTS-04", url: "/v1/tenant/code-lists", pass: "tenant_admin" },
  { gap: "ORG-HIERARCHY-04", url: "/v1/tenant/org/hierarchy", pass: "tenant_admin" },
  { gap: "POSITIONS-04", url: "/v1/tenant/positions", pass: "tenant_admin" },
  { gap: "STEWARDSHIP-04", url: "/v1/tenant/data-governance/domains", pass: "tenant_admin" },
  { gap: "HOME-01 (consent)", url: "/v1/tenant/consent/requests", pass: "tenant_admin" },
  { gap: "DATA-MIGRATION-04", url: "/v1/tenant/org/migrations", pass: "super_admin" },
];

describe("W2 tenant: /v1/tenant/* governance reads require an admin role (web-facing paths)", () => {
  for (const ep of WEB_PATHS) {
    describe(`${ep.gap}: GET ${ep.url}`, () => {
      const tid = randomUUID();

      it("401 without a token", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: ep.url });
        await app.close();
        expect(res.statusCode).toBe(401);
      });

      it("403 for a basic signed-in user", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: ep.url, headers: bearer(["employee"], tid) });
        await app.close();
        expect(res.statusCode).toBe(403);
      });

      it("admitted (200, or 404 when the tenant has no row yet) for the authorised admin role", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: ep.url, headers: bearer([ep.pass], tid) });
        await app.close();
        expect(res.statusCode).toBe(ep.admitted ?? 200);
      });
    });
  }

  describe("OVERVIEW-05: GET /v1/tenant/current", () => {
    it("401 without a token", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/v1/tenant/current" });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("an admin is never answered with a different tenant", async () => {
      const tid = randomUUID();
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/v1/tenant/current", headers: bearer(["tenant_admin"], tid) });
      await app.close();
      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const body = res.json() as Record<string, unknown>;
        const inner = (body.data ?? body) as Record<string, unknown>;
        expect(inner.id ?? inner.tenantId).toBe(tid);
      }
    });
  });
});

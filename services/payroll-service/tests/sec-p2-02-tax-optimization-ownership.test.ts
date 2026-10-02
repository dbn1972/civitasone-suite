/**
 * SEC-P2-02 regression: GET /v1/payroll/tax/optimization and GET
 * /v1/payroll/tax/regime-comparison previously took employeeId straight from
 * the query string with no ownership check — any authenticated
 * `employee`-role caller could pass a co-worker's UUID and read their 80C/
 * 80D declaration usage and remaining tax-saving headroom (cross-employee
 * financial disclosure). Both routes now call scopeEmployeeId(...) (shared/employee-scope.ts),
 * the same guard tax/routes.ts already uses for its own employeeId-scoped
 * endpoints. regime-comparison currently only returns stub/placeholder
 * figures, so it wasn't independently exploitable yet — fixed for
 * consistency (see gap-routes.ts) and covered here so it doesn't become a
 * silent gap the moment real computation is wired in.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN_ACTOR = randomUUID();
const EMP_ACTOR = randomUUID();
const EMP_OWN = randomUUID();
const EMP_OTHER = randomUUID();

// hrms-client is mocked: the employee's JWT subject resolves to a DIFFERENT
// hrms employee id (EMP_OWN). Ownership must be decided on that resolved id,
// never by comparing the raw actorId (P0 id-space fix).
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    resolveActorEmployeeId: vi.fn(async (_tenant: string, actorId: string) => (actorId === EMP_ACTOR ? EMP_OWN : null)),
  };
});

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "sec-p2-02" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

for (const path of ["/v1/payroll/tax/optimization", "/v1/payroll/tax/regime-comparison"]) {
  describe(`GET ${path} — ownership (SEC-P2-02)`, () => {
    it("rejects a self-service employee reading a co-worker's data (403)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `${path}?employeeId=${EMP_OTHER}`,
        headers: { authorization: `Bearer ${token(EMP_ACTOR, ["employee"])}` },
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });

    it("lets a self-service employee read their OWN data (200)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `${path}?employeeId=${EMP_OWN}`,
        headers: { authorization: `Bearer ${token(EMP_ACTOR, ["employee"])}` },
      });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json().employeeId).toBe(EMP_OWN);
    });

    it("lets a self-service employee omit employeeId and default to their OWN data (200)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: path,
        headers: { authorization: `Bearer ${token(EMP_ACTOR, ["employee"])}` },
      });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json().employeeId).toBe(EMP_OWN);
    });

    it("lets a payroll_admin read another employee's data unchanged (200)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `${path}?employeeId=${EMP_OTHER}`,
        headers: { authorization: `Bearer ${token(ADMIN_ACTOR, ["payroll_admin"])}` },
      });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json().employeeId).toBe(EMP_OTHER);
    });

    it("still requires employeeId from a privileged caller (400)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: path,
        headers: { authorization: `Bearer ${token(ADMIN_ACTOR, ["payroll_admin"])}` },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });
}

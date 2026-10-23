/**
 * CLOS2-S5-01: every :id path param in knowledge-service is a uuid column. A
 * malformed id used to reach Postgres (22P02) and surface as a retryable 500.
 * Each route must now answer 400 VALIDATION_FAILED, before any DB access.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const GOOD = "dddddddd-1111-4000-8000-0000000000ff";
const BAD = "not-a-uuid";
const token = () => signToken({ sub: "user-001", tid: TENANT, roles: ["knowledge_admin"], sid: "sess-001" }, SECRET);

afterAll(async () => { await sqlClient.end(); });

const P = "/v1/knowledge";
const idRoutes: Array<[string, string, unknown?]> = [
  ["GET", `${P}/categories/:id`], ["GET", `${P}/categories/:id/children`], ["GET", `${P}/categories/:id/ancestors`],
  ["PUT", `${P}/categories/:id`, { name: "x" }], ["DELETE", `${P}/categories/:id`],
  ["GET", `${P}/articles/:id`], ["PATCH", `${P}/articles/:id/publish`, { published: true }], ["GET", `${P}/categories/:id/articles`],
  ["GET", `${P}/shares/document/:id`], ["GET", `${P}/shares/:id`], ["DELETE", `${P}/shares/:id`],
  ["GET", `${P}/retention-policies/:id`], ["PUT", `${P}/retention-policies/:id`, { name: "x" }], ["POST", `${P}/retention-policies/:id/apply`, {}],
  ["GET", `${P}/policies/:id`], ["GET", `${P}/policies/:id/acknowledgements`], ["POST", `${P}/policies/:id/acknowledgements/report`, { expectedEmployeeIds: [] }],
  ["POST", `${P}/policies/:id/submit`, {}], ["POST", `${P}/policies/:id/approve`, {}], ["POST", `${P}/policies/:id/reject`, { reason: "not acceptable as drafted" }],
  ["POST", `${P}/policies/:id/publish`, {}], ["POST", `${P}/policies/:id/supersede`, {}], ["POST", `${P}/policies/:id/withdraw`, {}],
  ["POST", `${P}/policies/:id/acknowledge`, {}],
  ["GET", `${P}/faqs/:id`], ["PUT", `${P}/faqs/:id`, {}], ["DELETE", `${P}/faqs/:id`],
  ["GET", `${P}/guided-flows/:id`], ["PUT", `${P}/guided-flows/:id`, {}],
];

describe("CLOS2-S5-01: :id must be a uuid", () => {
  it.each(idRoutes)("%s %s with a malformed id is 400 VALIDATION_FAILED", async (method, tpl, payload) => {
    const app = await buildApp();
    const res = await app.inject({
      method: method as "GET", url: tpl.replace(":id", BAD),
      headers: { authorization: `Bearer ${token()}` }, ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    await app.close();
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("a well-formed but unknown uuid still 404s", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `${P}/categories/${GOOD}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

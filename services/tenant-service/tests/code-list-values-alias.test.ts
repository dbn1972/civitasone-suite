/**
 * GAP-TENANT-CODE-LISTS-01 — the web drill-down /tenant/code-lists/[code] calls
 * /api/v1/tenant/code-lists/:code/values, which the gateway forwards verbatim
 * as /v1/tenant/code-lists/:code/values. The values route existed only at
 * /v1/code-lists/:code/values, so the drill-down would 404.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa550002-5555-4000-8000-000000a50031";
const ACTOR = "aa55bbbb-5555-4000-8000-000000a5003b";
const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-cl01" }, SECRET, 3600)}` });

afterAll(async () => { await sqlClient.end(); });

describe("GAP-TENANT-CODE-LISTS-01: /v1/tenant/code-lists/:code/values", () => {
  it("returns the effective-dated values of a global list, same as the canonical route", async () => {
    const app = await buildApp();
    const alias = await app.inject({ method: "GET", url: "/v1/tenant/code-lists/gender/values", headers: auth(["tenant_admin"]) });
    const canon = await app.inject({ method: "GET", url: "/v1/code-lists/gender/values", headers: auth(["tenant_admin"]) });
    await app.close();
    expect(alias.statusCode).toBe(200);
    const body = JSON.parse(alias.body) as { data: Array<{ code: string; effectiveFrom: string }> };
    expect(body.data.map((v) => v.code).sort()).toEqual(["F", "M", "O"]);
    expect(body.data.every((v) => typeof v.effectiveFrom === "string")).toBe(true);
    expect(JSON.parse(canon.body)).toEqual(JSON.parse(alias.body));
  });

  it("404 LIST_NOT_FOUND for an unknown list; 401 without a token", async () => {
    const app = await buildApp();
    const nf = await app.inject({ method: "GET", url: "/v1/tenant/code-lists/no_such_list/values", headers: auth(["tenant_admin"]) });
    const anon = await app.inject({ method: "GET", url: "/v1/tenant/code-lists/gender/values" });
    await app.close();
    expect(nf.statusCode).toBe(404);
    expect(JSON.parse(nf.body).code).toBe("LIST_NOT_FOUND");
    expect(anon.statusCode).toBe(401);
  });
});

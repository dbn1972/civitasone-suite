/**
 * Municipal role catalog — policy-service stub registry for Sec5 services.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { listMunicipalRoleNames, MUNICIPAL_SERVICE_CATALOG } from "../src/modules/roles/municipal-catalog.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";

function token(roles: string[] = ["super_admin"]): string {
  return signToken(
    { sub: "00000000-cccc-4000-8000-000000000002", tid: TENANT, roles, sid: "sess-muni" },
    SECRET,
    3600,
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("municipal role catalog", () => {
  it("lists 17 municipal services with shop reference", () => {
    expect(MUNICIPAL_SERVICE_CATALOG).toHaveLength(17);
    expect(MUNICIPAL_SERVICE_CATALOG.map((s) => s.service)).toContain("shop");
    expect(MUNICIPAL_SERVICE_CATALOG.map((s) => s.service)).toContain("market");
  });

  it("includes core shop roles used by shop-service routes", () => {
    const shop = MUNICIPAL_SERVICE_CATALOG.find((s) => s.service === "shop");
    const names = shop?.roles.map((r) => r.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["shop_user", "shop_admin", "shop_officer"]));
  });

  it("registers at least 50 distinct municipal JWT role stubs", () => {
    expect(listMunicipalRoleNames().length).toBeGreaterThanOrEqual(50);
  });
});

describe("GET /policy/roles/catalog/municipal", () => {
  it("returns catalog for super_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/policy/roles/catalog/municipal",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { serviceCount: number } };
    expect(body.data).toHaveLength(17);
    expect(body.meta.serviceCount).toBe(17);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/policy/roles/catalog/municipal",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * CLOS-S4-02 -- GET /v1/contract/templates/:id/render JSON.parse()d the
 * `metadata` query param with no guard: malformed JSON threw a SyntaxError
 * (500 with the raw parser message) and non-object JSON (5, null, [1]) flowed
 * into renderTemplateClauses. It must now answer 400 INVALID_METADATA.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

vi.mock("../src/modules/templates/queries.js", async (orig) => {
  const actual = await orig<typeof import("../src/modules/templates/queries.js")>();
  return {
    ...actual,
    getTemplate: vi.fn(async (id: string) => ({ id, name: "T", status: "draft" })),
    getTemplateClauses: vi.fn(async () => []),
  };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a2";
const TEMPLATE = "11111111-2222-4000-8000-3333333333a2";
const headers = {
  authorization: `Bearer ${signToken({ sub: "00000000-aaaa-4000-8000-0000000000a2", tid: TENANT, roles: ["contract_admin"], sid: "s" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const render = (metadata?: string) =>
  app.inject({
    method: "GET",
    url: `/v1/contract/templates/${TEMPLATE}/render` + (metadata === undefined ? "" : `?metadata=${encodeURIComponent(metadata)}`),
    headers,
  });

describe("CLOS-S4-02: render metadata query param", () => {
  for (const bad of ["{bad", "5", "null", "[1]", '"str"']) {
    it(`rejects ${bad} with 400 INVALID_METADATA`, async () => {
      const res = await render(bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_METADATA");
      expect(res.body).not.toMatch(/Unexpected|position/i);
    });
  }

  it("accepts a JSON object", async () => {
    const res = await render('{"value":1}');
    expect(res.statusCode).toBe(200);
  });

  it("accepts a missing metadata param", async () => {
    const res = await render();
    expect(res.statusCode).toBe(200);
  });
});

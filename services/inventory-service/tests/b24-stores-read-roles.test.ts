/**
 * UAT b24: the GRN form lists receiving stores from GET /v1/inventory/stores, but the reader list left out the
 * procurement receiving roles, so a procurement_officer saw "No inventory stores available". They may now READ
 * stores; creating or editing a store stays with the inventory write roles.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const hdr = (role: string) => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: [role], sid: "s-b24" } as never, SECRET)}` });
afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/inventory/stores", () => {
  it.each(["procurement_officer", "procurement_admin", "store_officer"])("%s can read the store list", async (role) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/stores", headers: hdr(role) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("a read-only procurement role still cannot create or edit a store", async () => {
    const app = await buildApp();
    const post = await app.inject({ method: "POST", url: "/v1/inventory/stores", headers: hdr("procurement_officer"), payload: { name: "Central Stores", code: "CS01" } });
    expect(post.statusCode).toBe(403);
    const patch = await app.inject({ method: "PATCH", url: `/v1/inventory/stores/${randomUUID()}`, headers: hdr("procurement_officer"), payload: { name: "X" } });
    expect(patch.statusCode).toBe(403);
  });

  it("an unrelated role is still refused", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/stores", headers: hdr("hr_officer") });
    expect(res.statusCode).toBe(403);
  });
});

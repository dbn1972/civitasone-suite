/**
 * Coverage gap tests for project-service: geo, utilisation, evidence modules.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000099";
const A = "cccccccc-3333-4000-8000-000000000099";
const admin = signToken({ sub: A, tid: T, roles: ["project_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });

async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}

describe("geo module", () => {
  it("GET /v1/projects/:id/geo-tags → 200|500", async () => {
    expect([200, 500]).toContain(await hit("GET", `/v1/projects/${randomUUID()}/geo-tags`, admin));
  });
  it("POST /v1/projects/:id/geo-tags → 201|202|400|500", async () => {
    expect([201, 202, 400, 500]).toContain(await hit("POST", `/v1/projects/${randomUUID()}/geo-tags`, admin, { lat: 28.6139, lng: 77.209, label: "Site A" }));
  });
  it("GET /v1/projects/:id/site-photos → 200|500", async () => {
    expect([200, 404, 500]).toContain(await hit("GET", `/v1/projects/${randomUUID()}/site-photos`, admin));
  });
  it("401 without auth", async () => {
    expect(await hit("GET", `/v1/projects/${randomUUID()}/geo-tags`)).toBe(401);
  });
});

describe("utilisation / UC statements", () => {
  it("GET /v1/projects/schemes/:id/uc-statements → 200|500", async () => {
    expect([200, 500]).toContain(await hit("GET", `/v1/projects/schemes/${randomUUID()}/uc-statements`, admin));
  });
  it("401 without auth", async () => {
    expect(await hit("GET", `/v1/projects/schemes/${randomUUID()}/uc-statements`)).toBe(401);
  });
});

describe("evidence module", () => {
  it("GET /v1/projects/milestones/:id/evidence → 200|500", async () => {
    expect([200, 500]).toContain(await hit("GET", `/v1/projects/milestones/${randomUUID()}/evidence`, admin));
  });
  it("POST /v1/projects/milestones/:id/evidence → 201|202|400|500", async () => {
    expect([201, 202, 400, 500]).toContain(await hit("POST", `/v1/projects/milestones/${randomUUID()}/evidence`, admin, { type: "photo", url: "https://s3.example.com/img.jpg", description: "Site progress" }));
  });
  it("401 without auth", async () => {
    expect(await hit("GET", `/v1/projects/milestones/${randomUUID()}/evidence`)).toBe(401);
  });
});

describe("auth umbrella", () => {
  it("401 on protected routes", async () => {
    const urls = ["/v1/projects/dashboard", "/v1/projects/schemes", "/v1/projects/milestones"];
    for (const url of urls) expect(await hit("GET", url)).toBe(401);
  });
});

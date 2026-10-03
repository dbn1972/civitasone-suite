/** Workflow internal endpoints are service-to-service only: the gateway refuses them for any external caller. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TOKEN = signToken({ sub: "actor-1", tid: "tenant-1", roles: ["super_admin"] }, SECRET, 3600);
let upstreamCalls: string[] = [];

beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("gateway deny: /v1/workflow/internal/*", () => {
  it.each(["/api/v1/workflow/internal/open-task-refs", "/api/v1/workflow/internal"])(
    "403s %s even with a valid bearer token and forwards nothing", async (path) => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: path, headers: { authorization: `Bearer ${TOKEN}`, "x-internal": "1" }, payload: {} });
      expect(res.statusCode).toBe(403);
      expect(upstreamCalls).toEqual([]);
      await app.close();
    });

  it("does not block ordinary workflow routes", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/workflow/tasks", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).not.toBe(403);
    expect(upstreamCalls.length).toBeGreaterThan(0);
    await app.close();
  });
});

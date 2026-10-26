/**
 * fastify-bodylimit-guard.mjs -- fixture tests + a run against the real tree.
 *
 * The guard is the compensating control for the allow-listed zod 3.x advisory
 * GHSA-mrhx-c7xc-m3w5 (see scripts/ci/cve-allowlist.json): no service may accept a
 * request body big enough to build an oversized zod collection.
 *
 * Run: pnpm exec vitest run tests/architecture/fastify-bodylimit-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
// @ts-expect-error -- plain .mjs script, no type declarations
import { checkSource, CAP_BYTES } from "../../scripts/ci/fastify-bodylimit-guard.mjs";

const rules = (src: string, g?: (n: string) => string | null) =>
  (checkSource(src, g) as Array<{ rule: string }>).map((v) => v.rule);

describe("fastify-bodylimit-guard", () => {
  it("passes an explicit 1 MiB cap", () => {
    expect(rules("const app = Fastify({ bodyLimit: 1_048_576, logger: true });")).toEqual([]);
  });
  it("fails a Fastify app with no bodyLimit", () => {
    expect(rules("const app = Fastify({ logger: true });")).toEqual(["fastify-no-bodylimit"]);
  });
  it("fails Fastify() with no options object", () => {
    expect(rules("const app = Fastify();")).toEqual(["fastify-no-options"]);
  });
  it("ignores a bodyLimit that only appears in a comment or string", () => {
    expect(rules('const app = Fastify({ logger: { msg: "bodyLimit: 1" } /* bodyLimit: 1 */ });')).toEqual(["fastify-no-bodylimit"]);
  });
  it("fails a bodyLimit above the cap", () => {
    expect(rules(`const app = Fastify({ bodyLimit: ${CAP_BYTES + 1} });`)).toEqual(["fastify-bodylimit-too-high"]);
    expect(rules("const app = Fastify({ bodyLimit: 50 * 1024 * 1024 });")).toEqual(["fastify-bodylimit-too-high"]);
    expect(rules("const app = Fastify({ bodyLimit: SOMETHING });")).toEqual(["fastify-bodylimit-unbounded"]);
  });
  it("fails an env-driven bodyLimit without a Math.min ceiling, passes a clamped one", () => {
    expect(rules("Fastify({ bodyLimit: Number(process.env.X ?? 1_048_576) });")).toEqual(["fastify-bodylimit-env-unclamped"]);
    expect(rules("Fastify({ bodyLimit: Math.min(Number(process.env.X ?? 1_048_576), 10_485_760) });")).toEqual([]);
  });
  it("resolves a route-level const and fails one over the cap", () => {
    expect(rules("const L = 7_000_000;\napp.route({ bodyLimit: L });")).toEqual([]);
    expect(rules("const L = 60 * 1024 * 1024;\napp.post('/x', { bodyLimit: L }, h);")).toEqual(["route-bodylimit-too-high"]);
  });
  it("resolves a const exported from another file, and fails an unresolvable one", () => {
    expect(rules("app.post('/x', { bodyLimit: MAX }, h);", (n) => (n === "MAX" ? "16 * 1024" : null))).toEqual([]);
    expect(rules("app.post('/x', { bodyLimit: MAX }, h);")).toEqual(["route-bodylimit-unresolvable"]);
  });
  it("fails a content-type parser that lifts the limit", () => {
    expect(rules("app.addContentTypeParser('x/y', { parseAs: 'buffer', bodyLimit: 999_999_999 }, p);")).toEqual(["route-bodylimit-too-high"]);
  });
  it("fails multipart registered without limits", () => {
    expect(rules("app.register(multipart);")).toEqual(["multipart-no-limits"]);
    expect(rules("app.register(multipart, { limits: { fileSize: 1000 } });")).toEqual([]);
  });
  it("passes on the real tree", () => {
    const out = execFileSync("node", ["scripts/ci/fastify-bodylimit-guard.mjs"], { encoding: "utf8" });
    expect(out).toContain("fastify-bodylimit-guard: OK");
  });
});

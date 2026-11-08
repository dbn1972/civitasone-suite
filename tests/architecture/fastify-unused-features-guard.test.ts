/**
 * fastify-unused-features-guard.mjs -- fixture tests + a run against the real tree.
 *
 * Run: pnpm exec vitest run tests/architecture/fastify-unused-features-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
// @ts-expect-error -- plain .mjs script, no type declarations
import { checkSource } from "../../scripts/ci/fastify-unused-features-guard.mjs";

const rules = (src: string) => (checkSource(src) as Array<{ rule: string }>).map((v) => v.rule);

describe("fastify-unused-features-guard", () => {
  it("fails a route-options schema on app.post(url, opts, handler)", () => {
    expect(rules("app.post('/x', { schema: { body: B } }, async () => {});")).toEqual(["route-schema"]);
  });
  it("fails schema on .route({...}), including shorthand and quoted keys", () => {
    expect(rules("app.route({ method: 'GET', url: '/x', schema: S, handler });")).toEqual(["route-schema"]);
    expect(rules("app.route({ method: 'GET', url: '/x', schema, handler });")).toEqual(["route-schema"]);
    expect(rules("app.get('/x', { \"schema\": S }, h);")).toEqual(["route-schema"]);
  });
  it("fails on other receivers and chained calls (scope.get, fastify.delete)", () => {
    expect(rules("scope.get('/x', { preHandler: p, schema: S }, h);")).toEqual(["route-schema"]);
    expect(rules("fastify.delete('/x', { schema: S }, h);")).toEqual(["route-schema"]);
  });
  it("does NOT flag a zod object named schema inside a handler", () => {
    expect(rules("app.post('/x', async (req) => { const schema = z.object({}); return schema.parse(req.body); });")).toEqual([]);
    expect(rules("app.post('/x', { preHandler: p }, async (req) => { const { schema } = cfg; return schema; });")).toEqual([]);
  });
  it("does NOT flag schema keys in nested calls, maps or unrelated objects", () => {
    expect(rules("app.post('/x', validate({ schema: z.object({}) }), h);")).toEqual([]);
    expect(rules("const v = cache.get('schema');")).toEqual([]);
    expect(rules("const o = { schema: 1 }; foo(o);")).toEqual([]);
    expect(rules("app.get('/x', { config: { schema: 1 } }, h);")).toEqual([]);
  });
  it("ignores mentions in comments and string literals", () => {
    expect(rules("// app.setNotFoundHandler(h)\n/* $async attachValidation */ const s = 'addSchema(x) setValidatorCompiler';")).toEqual([]);
  });
  it("fails each forbidden API", () => {
    expect(rules("const s = { $async: true };")).toEqual(["async-validation"]);
    expect(rules("app.post('/x', { attachValidation: true }, h);")).toEqual(["attach-validation"]);
    expect(rules("app.setValidatorCompiler(c);")).toEqual(["set-validator-compiler"]);
    expect(rules("app.addSchema({ $id: 'x' });")).toEqual(["add-schema"]);
    expect(rules("app.setNotFoundHandler(h);")).toEqual(["set-not-found-handler"]);
  });
  it("passes on the real tree", () => {
    const out = execFileSync("node", ["scripts/ci/fastify-unused-features-guard.mjs"], { encoding: "utf8" });
    expect(out).toContain("fastify-unused-features-guard: OK");
  });
});

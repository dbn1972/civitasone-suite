/**
 * SEC-P0-03 regression: plugin hook handlers must NOT reach host capabilities.
 *
 * The old engine used `new Function(handler)` which ran plugin code in the host
 * module scope — `process`, `require`, `fs` were all reachable (RCE). These
 * tests assert the isolated vm sandbox denies each of those and still runs
 * legitimate handlers. They FAIL against `new Function` (which resolves the
 * host `process`/`require`) and PASS against the vm sandbox.
 */
import { describe, it, expect } from "vitest";
import { runInSandbox, type SandboxApi } from "../src/modules/runtime/sandbox/runtime.js";

function api(overrides: Partial<SandboxApi> = {}): SandboxApi {
  return {
    tenantId: "t1",
    eventType: "test.event",
    payload: { a: 1 },
    correlationId: "c1",
    log: () => {},
    emit: () => {},
    ...overrides,
  };
}

describe("plugin sandbox isolation (SEC-P0-03)", () => {
  it("denies access to process", async () => {
    const r = await runInSandbox("return process.env;", api(), 2000);
    expect(r.output).toBeUndefined();
    expect(r.error).toMatch(/process is not defined/);
  });

  it("denies access to require", async () => {
    const r = await runInSandbox('return require("node:fs").readFileSync("/etc/passwd");', api(), 2000);
    expect(r.error).toMatch(/require is not defined/);
  });

  it("denies access to module/globalThis host bindings", async () => {
    const r = await runInSandbox("return globalThis.process ?? module;", api(), 2000);
    // globalThis.process is undefined in the fresh context; `module` is not defined.
    expect(r.error).toMatch(/module is not defined/);
  });

  it("blocks the constructor realm-escape to the host process", async () => {
    const r = await runInSandbox(
      'return this.constructor.constructor("return typeof process")();',
      api(),
      2000,
    );
    // The `.constructor.constructor` chain resolves to the *context's own*
    // Function (not the host's), which is bound by this context's codegen
    // policy — so the reach-back is denied with EvalError before any host
    // process can be reached. No host object is ever returned.
    expect(r.output).toBeUndefined();
    expect(r.error).toMatch(/Code generation from strings|Cannot read propert|not defined/);
  });

  it("blocks the constructor realm-escape via a host callback (ctx.log)", async () => {
    // ctx.log/ctx.emit are real host-realm functions handed into the sandbox.
    // Before sealHostFunction()/the null-prototype ctx wrapper, `ctx.log
    // .constructor` resolved to the HOST `Function` constructor (a realm with
    // no codeGeneration restriction at all — that policy only binds the vm
    // context's OWN Function/eval), so this string compiled and ran as host
    // code and returned the real host `process`. It must now be denied.
    const r = await runInSandbox(
      'return ctx.log.constructor.constructor("return typeof process")();',
      api(),
      2000,
    );
    expect(r.output).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it("blocks the constructor realm-escape via the ctx object itself", async () => {
    // Same reach-back, one hop shorter: `ctx` is an ordinary object, so
    // `ctx.constructor` (Object.prototype's, inherited) also chains to the
    // host `Function` constructor — independent of ctx.log/ctx.emit.
    const r = await runInSandbox(
      'return ctx.constructor.constructor("return typeof process")();',
      api(),
      2000,
    );
    expect(r.output).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it("blocks the constructor realm-escape via ctx.payload (an object VALUE, not ctx itself)", async () => {
    // Independent of both escapes above: sealing `ctx` and its FUNCTION
    // properties does nothing for an object VALUE nested inside `ctx` (e.g.
    // ctx.payload) — that object is still an ordinary object created in the
    // host realm, so its inherited `.constructor` reaches the same host
    // Function constructor the same way. Found in independent review before
    // this test existed: this line returned the real host `process.version`
    // (e.g. "v22.23.2") prior to the payload-rehydration fix.
    const r = await runInSandbox(
      'return ctx.payload.constructor.constructor("return typeof process")();',
      api({ payload: { a: 1 } }),
      2000,
    );
    expect(r.output).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it("still delivers a working, deeply-equal payload after rehydration", async () => {
    // The fix for the escape above reconstructs ctx.payload via JSON
    // round-tripping INSIDE the vm context rather than passing the live
    // object through — confirm that doesn't silently corrupt or drop data
    // for a realistic nested payload.
    const payload = { billId: "bill-123", amount: 50000, tags: ["urgent", "reviewed"], meta: { ok: true } };
    const r = await runInSandbox(
      "return JSON.stringify(ctx.payload);",
      api({ payload }),
      2000,
    );
    expect(r.error).toBeUndefined();
    expect(JSON.parse(r.output as string)).toEqual(payload);
  });

  it("does not crash on a payload that cannot be JSON-serialized (fails closed to null)", async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const r = await runInSandbox("return ctx.payload;", api({ payload: circular }), 2000);
    expect(r.error).toBeUndefined();
    expect(r.output).toBeNull();
  });

  it("blocks eval / Function code generation", async () => {
    const r = await runInSandbox('return eval("1+1");', api(), 2000);
    expect(r.error).toBeTruthy();
    expect(r.output).toBeUndefined();
  });

  it("aborts a runaway (infinite-loop) handler via timeout", async () => {
    const r = await runInSandbox("while (true) {}", api(), 300);
    expect(r.error).toBe("TIMEOUT");
  });

  it("runs a legitimate handler and returns its output", async () => {
    const r = await runInSandbox("return ctx.payload.a + 41;", api({ payload: { a: 1 } }), 2000);
    expect(r.error).toBeUndefined();
    expect(r.output).toBe(42);
  });

  it("exposes ctx.emit/ctx.log callbacks to the handler", async () => {
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const r = await runInSandbox(
      'ctx.log("info", "hi"); ctx.emit("did.thing", { ok: true }); return "done";',
      api({ emit: (type, payload) => emitted.push({ type, payload }) }),
      2000,
    );
    expect(r.error).toBeUndefined();
    expect(r.output).toBe("done");
    expect(emitted).toEqual([{ type: "did.thing", payload: { ok: true } }]);
  });

  it("reports a compile error for a syntactically invalid handler (no crash)", async () => {
    // Covers the vm.Script construction failure path — a malformed handler must
    // return a clean error, never throw out of the sandbox.
    const r = await runInSandbox("return ) syntax( {{", api(), 2000);
    expect(r.output).toBeUndefined();
    expect(r.error).toBeTruthy();
    expect(r.error).not.toBe("TIMEOUT");
  });

  it("surfaces a thrown error from the handler as a sandbox error", async () => {
    const r = await runInSandbox('throw new Error("boom");', api(), 2000);
    expect(r.output).toBeUndefined();
    expect(r.error).toMatch(/boom/);
  });

  it("propagates the handler's async return value", async () => {
    const r = await runInSandbox("return await Promise.resolve(ctx.payload.a * 2);", api({ payload: { a: 21 } }), 2000);
    expect(r.error).toBeUndefined();
    expect(r.output).toBe(42);
  });

  it("stringifies a non-Error thrown value (defensive fallback)", async () => {
    // Exercises the `instanceof Error ? … : String(err)` fallback branch.
    const r = await runInSandbox('throw "raw string failure";', api(), 2000);
    expect(r.output).toBeUndefined();
    expect(r.error).toBe("raw string failure");
  });
});

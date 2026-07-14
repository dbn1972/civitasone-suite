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
});

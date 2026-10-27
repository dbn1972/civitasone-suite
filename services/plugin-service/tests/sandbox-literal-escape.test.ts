/**
 * CodeQL js/bad-code-sanitization (#3356): values spliced into the vm source must be
 * encoded as fully-escaped JS string literals so hostile payloads/keys cannot break out.
 */
import { describe, it, expect } from "vitest";
import { runInSandbox, toJsStringLiteral, type SandboxApi } from "../src/modules/runtime/sandbox/runtime.js";

const HOSTILE = [
  '"); globalThis.pwned = 1; ("',
  "\u2028globalThis.pwned = 1;\u2029",
  "</script><script>globalThis.pwned=1</script>",
  "*/ globalThis.pwned = 1; /*",
  '\\"); globalThis.pwned = 1; //',
  "`${globalThis.pwned = 1}`",
];

function api(extra: Record<string, unknown>): SandboxApi {
  return { tenantId: "t", eventType: "e", payload: {}, correlationId: "c", log: () => undefined, emit: () => undefined, ...extra };
}

describe("toJsStringLiteral", () => {
  it.each(HOSTILE)("round-trips %j and emits no raw line terminators or HTML metacharacters", (v) => {
    const lit = toJsStringLiteral(v);
    expect(lit).not.toMatch(/[\u2028\u2029<>\n\r]/);
    expect(lit).not.toContain("/");
    expect(JSON.parse(lit)).toBe(v);
    expect(new Function(`return ${lit}`)()).toBe(v);
  });
});

describe("runInSandbox hostile embedded values", () => {
  it.each(HOSTILE)("keeps payload %j as inert data", async (v) => {
    const res = await runInSandbox("return ctx.payload.v;", api({ payload: { v } }), 2000);
    expect(res.error).toBeUndefined();
    expect(res.output).toBe(v);
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined();
  });

  it.each(HOSTILE)("keeps ctx key %j as a property name, not code", async (k) => {
    const res = await runInSandbox("return Object.keys(ctx).includes(" + JSON.stringify(k) + ");", api({ [k]: { a: 1 } }), 2000);
    expect(res.error).toBeUndefined();
    expect(res.output).toBe(true);
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined();
  });
});

/**
 * W2.3 — Hardened Plugin Sandbox tests.
 *
 * PROPERTY: A signed third-party plugin runs sandboxed and CANNOT exceed its
 * declared permissions. Specifically:
 * - Cannot access process.env
 * - Cannot require() modules
 * - Cannot escape via eval/Function constructor
 * - Is terminated on timeout
 * - Cannot access undeclared permissions
 */
import { describe, it, expect } from "vitest";
import { executePlugin, validatePluginCode, type PluginManifest, type PluginContext } from "../src/modules/sandbox/hardened-runtime.js";

const TEST_MANIFEST: PluginManifest = {
  id: "test-plugin-001",
  name: "test-plugin",
  permissions: ["read:tenant"],
  timeoutMs: 3000,
  memoryMb: 32,
};

const TEST_CONTEXT: PluginContext = {
  tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
  actorId: "user-test",
  correlationId: "corr-001",
  params: { greeting: "hello" },
};

describe("W2.3 — Plugin sandbox execution", () => {
  it("executes valid code and returns output", async () => {
    const result = await executePlugin(TEST_MANIFEST, "return ctx.params.greeting + ' world';", TEST_CONTEXT);
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello world");
    expect(result.executionMs).toBeLessThan(3000);
  });

  it("can read tenant context", async () => {
    const result = await executePlugin(TEST_MANIFEST, "return ctx.tenantId;", TEST_CONTEXT);
    expect(result.success).toBe(true);
    expect(result.output).toBe(TEST_CONTEXT.tenantId);
  });

  it("is terminated on timeout (no infinite loops)", async () => {
    const manifest = { ...TEST_MANIFEST, timeoutMs: 500 };
    const result = await executePlugin(manifest, "while(true) {}", TEST_CONTEXT);
    expect(result.success).toBe(false);
    // Worker may be killed by timeout or by vm.Script timeout — either way it fails
    expect(result.error).toMatch(/TIMEOUT|WORKER_EXIT|WORKER_ERROR|timed out/i);
    expect(result.executionMs).toBeLessThan(2000);
  }, 10000);

  it("cannot access process.env (returns undefined)", async () => {
    const result = await executePlugin(TEST_MANIFEST, "return typeof process;", TEST_CONTEXT);
    expect(result.success).toBe(true);
    expect(result.output).toBe("undefined");
  });

  it("cannot require() modules", async () => {
    const result = await executePlugin(TEST_MANIFEST, "return typeof require;", TEST_CONTEXT);
    expect(result.success).toBe(true);
    expect(result.output).toBe("undefined");
  });

  it("cannot access globalThis", async () => {
    const result = await executePlugin(TEST_MANIFEST, "return typeof globalThis;", TEST_CONTEXT);
    expect(result.success).toBe(true);
    expect(result.output).toBe("undefined");
  });

  it("handles plugin runtime errors gracefully", async () => {
    const result = await executePlugin(TEST_MANIFEST, "throw new Error('plugin bug');", TEST_CONTEXT);
    expect(result.success).toBe(false);
    expect(result.error).toContain("plugin bug");
  });
});

describe("W2.3 — Plugin code static validation", () => {
  it("detects process.env access", () => {
    const violations = validatePluginCode("const x = process.env.SECRET;");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("process.env");
  });

  it("detects require() usage", () => {
    const violations = validatePluginCode("const fs = require('fs');");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("require()");
  });

  it("detects eval() usage", () => {
    const violations = validatePluginCode("eval('dangerous code')");
    expect(violations.some((v) => v.includes("eval()"))).toBe(true);
  });

  it("detects Function constructor", () => {
    const violations = validatePluginCode("new Function('return 1')()");
    expect(violations.some((v) => v.includes("Function constructor"))).toBe(true);
  });

  it("clean code passes validation", () => {
    const violations = validatePluginCode("const result = ctx.params.x * 2; return result;");
    expect(violations).toHaveLength(0);
  });
});

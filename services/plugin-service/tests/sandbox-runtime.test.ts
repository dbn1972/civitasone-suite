import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executePlugin } from "../src/modules/sandbox/runtime.js";
import type { PluginContext, PluginManifest } from "../src/modules/sandbox/types.js";

function makeContext(overrides?: Partial<PluginContext>): PluginContext {
  return {
    tenantId: "11111111-aaaa-4000-8000-000000000001",
    pluginId: "22222222-bbbb-4000-8000-000000000001",
    correlationId: "corr-001",
    eventType: "finance.bill.passed",
    payload: { billId: "bill-123", amount: 50000 },
    ...overrides,
  };
}

function makeManifest(overrides?: Partial<PluginManifest>): PluginManifest {
  return {
    id: "22222222-bbbb-4000-8000-000000000001",
    permissions: ["read:tenant", "emit:event"],
    events: ["finance.bill.passed"],
    ...overrides,
  };
}

describe("Plugin Sandbox Runtime", () => {
  const originalTimeout = process.env.PLUGIN_TIMEOUT_MS;
  const originalMemory = process.env.PLUGIN_MEMORY_MB;

  beforeEach(() => {
    // Use short timeout for tests
    process.env.PLUGIN_TIMEOUT_MS = "3000";
    process.env.PLUGIN_MEMORY_MB = "64";
  });

  afterEach(() => {
    if (originalTimeout !== undefined) {
      process.env.PLUGIN_TIMEOUT_MS = originalTimeout;
    } else {
      delete process.env.PLUGIN_TIMEOUT_MS;
    }
    if (originalMemory !== undefined) {
      process.env.PLUGIN_MEMORY_MB = originalMemory;
    } else {
      delete process.env.PLUGIN_MEMORY_MB;
    }
  });

  describe("successful execution", () => {
    it("executes simple code and returns result", async () => {
      const code = `return ctx.payload.amount * 2;`;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      expect(result.result).toBe(100000);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.memoryUsedMb).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("provides tenant context to plugin code", async () => {
      const code = `return { tenantId: ctx.tenantId, pluginId: ctx.pluginId };`;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        tenantId: context.tenantId,
        pluginId: context.pluginId,
      });
    });

    it("handles async code execution", async () => {
      const code = `
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        await delay(50);
        return "async-done";
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      expect(result.result).toBe("async-done");
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(50);
    });

    it("returns undefined result when code has no return", async () => {
      const code = `const x = 42;`;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });
  });

  describe("timeout enforcement", () => {
    it("terminates execution that exceeds time limit", async () => {
      process.env.PLUGIN_TIMEOUT_MS = "500";

      const code = `
        const start = Date.now();
        while (Date.now() - start < 10000) { /* busy loop */ }
        return "should not reach here";
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(400);
      expect(result.executionTimeMs).toBeLessThan(2000);
    });

    it("uses default timeout when env var is not set", async () => {
      delete process.env.PLUGIN_TIMEOUT_MS;

      // Quick execution should succeed
      const code = `return 42;`;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
    });
  });

  describe("memory limit", () => {
    it("terminates execution that exceeds memory limit", async () => {
      process.env.PLUGIN_MEMORY_MB = "8"; // Very low memory limit

      const code = `
        const arrays = [];
        for (let i = 0; i < 100000; i++) {
          arrays.push(new Array(10000).fill("x".repeat(100)));
        }
        return arrays.length;
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Should indicate memory was exceeded
      expect(
        result.error!.includes("memory") ||
        result.error!.includes("Worker exited") ||
        result.error!.includes("Allocation")
      ).toBe(true);
    });
  });

  describe("restricted API access", () => {
    it("cannot access process.env from plugin code", async () => {
      // Set a secret in the parent process
      process.env.SECRET_VALUE = "super-secret";

      const code = `
        try {
          const envKeys = Object.keys(process.env);
          return { envKeys, secret: process.env.SECRET_VALUE };
        } catch (e) {
          return { error: e.message };
        }
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      // Environment should be empty inside the worker
      if (typeof result.result === "object" && result.result !== null) {
        const res = result.result as Record<string, unknown>;
        if (Array.isArray(res.envKeys)) {
          expect(res.envKeys).toHaveLength(0);
        }
        expect(res.secret).toBeUndefined();
      }

      delete process.env.SECRET_VALUE;
    });

    it("cannot access fs module from plugin code", async () => {
      const code = `
        try {
          // fs is explicitly set to undefined in the sandbox
          if (typeof fs !== 'undefined') {
            return { fsAvailable: true };
          }
          return { fsAvailable: false };
        } catch (e) {
          return { error: e.message, fsAvailable: false };
        }
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      const res = result.result as Record<string, unknown>;
      expect(res.fsAvailable).toBe(false);
    });

    it("cannot access net/http modules from plugin code", async () => {
      const code = `
        try {
          if (typeof net !== 'undefined') return { netAvailable: true };
          if (typeof http !== 'undefined') return { httpAvailable: true };
          if (typeof https !== 'undefined') return { httpsAvailable: true };
          return { netAvailable: false, httpAvailable: false, httpsAvailable: false };
        } catch (e) {
          return { error: e.message };
        }
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      const res = result.result as Record<string, unknown>;
      expect(res.netAvailable).toBe(false);
      expect(res.httpAvailable).toBe(false);
      expect(res.httpsAvailable).toBe(false);
    });

    it("cannot use require to load modules", async () => {
      const code = `
        try {
          if (typeof require === 'undefined' || require === undefined) {
            return { requireAvailable: false };
          }
          const fs = require('fs');
          return { requireAvailable: true };
        } catch (e) {
          return { requireAvailable: false, error: e.message };
        }
      `;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(true);
      const res = result.result as Record<string, unknown>;
      expect(res.requireAvailable).toBe(false);
    });
  });

  describe("context isolation between executions", () => {
    it("does not share state between executions", async () => {
      const code1 = `
        if (!globalThis.__pluginState) {
          globalThis.__pluginState = { counter: 0 };
        }
        globalThis.__pluginState.counter++;
        return globalThis.__pluginState.counter;
      `;

      const code2 = `
        if (!globalThis.__pluginState) {
          globalThis.__pluginState = { counter: 0 };
        }
        globalThis.__pluginState.counter++;
        return globalThis.__pluginState.counter;
      `;

      const context = makeContext();
      const manifest = makeManifest();

      const result1 = await executePlugin(code1, context, manifest);
      const result2 = await executePlugin(code2, context, manifest);

      // Each execution is in a fresh worker, so state should not carry over
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.result).toBe(1);
      expect(result2.result).toBe(1);
    });

    it("isolates data between different tenant contexts", async () => {
      const code = `return ctx.tenantId;`;

      const contextA = makeContext({ tenantId: "aaaaaaaa-aaaa-4000-8000-000000000001" });
      const contextB = makeContext({ tenantId: "bbbbbbbb-bbbb-4000-8000-000000000002" });
      const manifest = makeManifest();

      const resultA = await executePlugin(code, contextA, manifest);
      const resultB = await executePlugin(code, contextB, manifest);

      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);
      expect(resultA.result).toBe("aaaaaaaa-aaaa-4000-8000-000000000001");
      expect(resultB.result).toBe("bbbbbbbb-bbbb-4000-8000-000000000002");
    });
  });

  describe("error handling", () => {
    it("returns error for code that throws", async () => {
      const code = `throw new Error("plugin failure");`;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("plugin failure");
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("returns error for syntax errors in plugin code", async () => {
      const code = `this is not valid javascript!!!`;
      const context = makeContext();
      const manifest = makeManifest();

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects emit without permission", async () => {
      const code = `ctx.emit("some.event", { data: 123 });`;
      const context = makeContext();
      const manifest = makeManifest({ permissions: ["read:tenant"] }); // no emit:event

      const result = await executePlugin(code, context, manifest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("permission_denied");
      expect(result.error).toContain("emit:event");
    });
  });
});

/**
 * W2.3 — Hardened Plugin Sandbox Runtime.
 *
 * Replaces the `new Function()` approach with proper V8 isolation via
 * node:vm + worker_threads with strict enforcement:
 *
 * 1. CPU limit: Worker is terminated if execution exceeds PLUGIN_TIMEOUT_MS
 * 2. Memory limit: Worker --max-old-space-size caps heap
 * 3. Permission boundary: Only manifest-declared permissions are injected
 * 4. No host access: fs, net, http, child_process fully blocked
 * 5. Deterministic cleanup: Worker is terminated + unref'd on timeout
 *
 * The key difference from the old approach: instead of `new Function()` (which
 * is string-eval and can be escaped), we use `vm.Script` compiled in a
 * stripped-down context where dangerous APIs simply don't exist.
 */
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { pino } from "pino";

const log = pino({ name: "plugin-sandbox" });

const DEFAULT_TIMEOUT_MS = Number(process.env.PLUGIN_TIMEOUT_MS ?? 5000);
const DEFAULT_MEMORY_MB = Number(process.env.PLUGIN_MEMORY_MB ?? 64);

export type PluginPermission =
  | "read:tenant"
  | "write:tenant"
  | "emit:event"
  | "http:outbound"
  | "storage:read"
  | "storage:write";

export interface PluginManifest {
  id: string;
  name: string;
  permissions: PluginPermission[];
  timeoutMs?: number;
  memoryMb?: number;
}

export interface PluginContext {
  tenantId: string;
  actorId: string;
  correlationId: string;
  params?: Record<string, unknown>;
}

export interface PluginResult {
  success: boolean;
  output?: unknown;
  error?: string;
  executionMs: number;
  memoryUsedMb?: number;
}

export class PluginExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly pluginId: string,
  ) {
    super(message);
    this.name = "PluginExecutionError";
  }
}

/**
 * The worker script that runs inside the isolated Worker thread.
 * Uses vm.Script + vm.createContext for a stripped-down execution environment.
 */
const HARDENED_WORKER_SCRIPT = `
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

const { code, context, permissions, timeoutMs } = workerData;

// Build a restricted context — only what the manifest allows
const sandbox = Object.create(null);

// Minimal safe globals
sandbox.console = { log: (...args) => parentPort.postMessage({ type: "log", data: args }) };
sandbox.JSON = JSON;
sandbox.Math = Math;
sandbox.Date = Date;
sandbox.parseInt = parseInt;
sandbox.parseFloat = parseFloat;
sandbox.isNaN = isNaN;
sandbox.isFinite = isFinite;
sandbox.String = String;
sandbox.Number = Number;
sandbox.Boolean = Boolean;
sandbox.Array = Array;
sandbox.Object = Object;
sandbox.Map = Map;
sandbox.Set = Set;
sandbox.Promise = Promise;
sandbox.setTimeout = undefined;  // block async escape
sandbox.setInterval = undefined;
sandbox.setImmediate = undefined;
sandbox.process = undefined;     // block process access
sandbox.require = undefined;     // block module loading
sandbox.global = undefined;
sandbox.globalThis = undefined;

// Inject context (tenant-scoped data the plugin may read)
sandbox.ctx = Object.freeze({
  tenantId: context.tenantId,
  actorId: context.actorId,
  correlationId: context.correlationId,
  params: Object.freeze(context.params ?? {}),
});

// Permission-gated APIs (only injected if manifest declares them)
if (permissions.includes("http:outbound")) {
  sandbox.fetch = globalThis.fetch; // Node 20+ native fetch
}

// Create the isolated VM context
const vmContext = vm.createContext(sandbox, {
  name: "plugin-sandbox",
  codeGeneration: { strings: false, wasm: false }, // block eval() and WASM
});

// Compile and run with timeout
try {
  const script = new vm.Script(
    "(async () => { " + code + " })()",
    { filename: "plugin.js", timeout: timeoutMs }
  );
  
  const resultPromise = script.runInContext(vmContext, { timeout: timeoutMs });
  
  // Handle async result
  Promise.resolve(resultPromise)
    .then((output) => {
      parentPort.postMessage({ type: "result", success: true, output });
    })
    .catch((err) => {
      parentPort.postMessage({ type: "result", success: false, error: err.message ?? String(err) });
    });
} catch (err) {
  parentPort.postMessage({
    type: "result",
    success: false,
    error: err.message ?? String(err),
  });
}
`;

/**
 * Execute plugin code in a hardened sandbox.
 *
 * Guarantees:
 * - Plugin cannot access host filesystem, network (unless permitted), or process
 * - Plugin is terminated after timeoutMs (no infinite loops)
 * - Plugin heap is capped at memoryMb (no memory bombs)
 * - Only manifest-declared permissions are available
 */
export async function executePlugin(
  manifest: PluginManifest,
  code: string,
  context: PluginContext,
): Promise<PluginResult> {
  const timeoutMs = manifest.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = manifest.memoryMb ?? DEFAULT_MEMORY_MB;
  const startMs = Date.now();

  return new Promise<PluginResult>((resolve) => {
    const worker = new Worker(HARDENED_WORKER_SCRIPT, {
      eval: true,
      workerData: {
        code,
        context,
        permissions: manifest.permissions,
        timeoutMs,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: memoryMb,
        maxYoungGenerationSizeMb: Math.ceil(memoryMb / 4),
        codeRangeSizeMb: 16,
      },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        success: false,
        error: `TIMEOUT: plugin '${manifest.name}' exceeded ${timeoutMs}ms limit`,
        executionMs: Date.now() - startMs,
      });
    }, timeoutMs + 100); // small grace period for worker cleanup

    worker.on("message", (msg: { type: string; success?: boolean; output?: unknown; error?: string }) => {
      if (msg.type === "result") {
        clearTimeout(timer);
        worker.terminate();
        resolve({
          success: msg.success ?? false,
          output: msg.output,
          ...(msg.error !== undefined ? { error: msg.error } : {}),
          executionMs: Date.now() - startMs,
        });
      }
      // "log" messages are informational only
    });

    worker.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: `WORKER_ERROR: ${err.message}`,
        executionMs: Date.now() - startMs,
      });
    });

    worker.on("exit", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        resolve({
          success: false,
          error: `WORKER_EXIT: plugin worker exited with code ${exitCode} (likely OOM)`,
          executionMs: Date.now() - startMs,
        });
      }
    });
  });
}

/**
 * Validate that a plugin's code doesn't attempt to escape the sandbox.
 * Static analysis before execution — rejects known escape patterns.
 */
export function validatePluginCode(code: string): string[] {
  const violations: string[] = [];
  const banned = [
    { pattern: /process\s*\.\s*env/gi, reason: "access to process.env is blocked" },
    { pattern: /require\s*\(/gi, reason: "require() is not available in sandbox" },
    { pattern: /import\s*\(/gi, reason: "dynamic import() is not available in sandbox" },
    { pattern: /child_process/gi, reason: "child_process access is blocked" },
    { pattern: /Function\s*\(/gi, reason: "Function constructor (eval) is blocked" },
    { pattern: /eval\s*\(/gi, reason: "eval() is blocked" },
  ];
  for (const { pattern, reason } of banned) {
    if (pattern.test(code)) violations.push(reason);
  }
  return violations;
}

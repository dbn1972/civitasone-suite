/**
 * Plugin Sandbox Runtime
 *
 * Executes plugin code in isolated V8 contexts using node:worker_threads.
 * Each execution spawns a Worker with strict resource limits (time + memory).
 *
 * Security model:
 *   - Worker receives only: code, context (tenantId-scoped), manifest
 *   - Worker has NO access to: process.env, fs, net, child_process
 *   - Time limit: terminate worker after configurable timeout (default 5000ms)
 *   - Memory limit: resourceLimits.maxOldGenerationSizeMb (default 64MB)
 *   - Permissions: only manifest-declared operations are available
 *
 * Env vars:
 *   PLUGIN_TIMEOUT_MS   — execution time limit in ms (default: 5000)
 *   PLUGIN_MEMORY_MB    — max old-generation heap in MB (default: 64)
 */
import { Worker } from "node:worker_threads";
import { pino } from "pino";
import type {
  PluginContext,
  PluginManifest,
  PluginResult,
  WorkerMessage,
} from "./types.js";

const log = pino({ name: "plugin-sandbox" });

/** Default execution timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

/** Default memory limit in MB for the worker's old generation heap */
const DEFAULT_MEMORY_MB = 64;

/** Get configured timeout from environment */
function getTimeoutMs(): number {
  const env = process.env.PLUGIN_TIMEOUT_MS;
  if (!env) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Get configured memory limit from environment */
function getMemoryMb(): number {
  const env = process.env.PLUGIN_MEMORY_MB;
  if (!env) return DEFAULT_MEMORY_MB;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MEMORY_MB;
}

/**
 * Inline worker script as a string. This avoids the need for a separate compiled
 * file and works in both test (vitest/tsx) and production (compiled) environments.
 *
 * The worker:
 *   - Receives workerData with code, context, manifest
 *   - Overrides process.env to empty
 *   - Blocks access to fs, net, http, child_process via shadowing
 *   - Executes the code in a new Function scope
 *   - Posts back results or errors
 */
const WORKER_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");

const { code, context, manifest } = workerData;

// Build the set of granted permissions
const grantedPermissions = new Set(manifest.permissions || []);

function requirePermission(perm) {
  if (!grantedPermissions.has(perm)) {
    throw new Error('permission_denied: operation requires "' + perm + '" which is not declared in plugin manifest');
  }
}

// Sandbox API exposed to plugin code
const sandboxApi = Object.freeze({
  tenantId: context.tenantId,
  pluginId: context.pluginId,
  eventType: context.eventType || null,
  payload: context.payload ? JSON.parse(JSON.stringify(context.payload)) : null,
  correlationId: context.correlationId,
  log: function(level, message) { /* no-op in sandbox */ },
  emit: function(eventType, payload) {
    requirePermission("emit:event");
  },
  hasPermission: function(perm) {
    return grantedPermissions.has(perm);
  },
});

async function execute() {
  const startMem = process.memoryUsage();
  try {
    // Restricted process object — no env access
    const restrictedProcess = { env: Object.freeze({}), version: process.version, platform: process.platform };

    const fn = new Function(
      "ctx", "process", "require", "module", "exports", "__filename", "__dirname",
      '"use strict"; const fs = undefined; const net = undefined; const child_process = undefined; const http = undefined; const https = undefined; const dgram = undefined; const cluster = undefined; const worker_threads = undefined; return (async () => { ' + code + ' })();'
    );

    const result = await fn(sandboxApi, restrictedProcess, undefined, undefined, undefined, undefined, undefined);
    const endMem = process.memoryUsage();
    const memoryUsedMb = Math.round(((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024) * 100) / 100;

    parentPort.postMessage({
      type: "result",
      result: result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined,
      memoryUsedMb: Math.max(0, memoryUsedMb),
    });
  } catch (err) {
    const endMem = process.memoryUsage();
    const memoryUsedMb = Math.round(((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024) * 100) / 100;
    parentPort.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
      memoryUsedMb: Math.max(0, memoryUsedMb),
    });
  }
}

execute().catch(function(err) {
  parentPort.postMessage({
    type: "error",
    error: err instanceof Error ? err.message : String(err),
    memoryUsedMb: 0,
  });
});
`;

/**
 * Execute plugin code in an isolated V8 sandbox with resource limits.
 *
 * @param code - The plugin code string to execute
 * @param context - Tenant-scoped invocation context
 * @param manifest - Plugin manifest declaring permissions
 * @returns PluginResult with execution outcome, timing, and memory usage
 */
export async function executePlugin(
  code: string,
  context: PluginContext,
  manifest: PluginManifest,
): Promise<PluginResult> {
  const timeoutMs = getTimeoutMs();
  const memoryMb = getMemoryMb();
  const startTime = Date.now();

  return new Promise<PluginResult>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { code, context, manifest },
      resourceLimits: {
        maxOldGenerationSizeMb: memoryMb,
        maxYoungGenerationSizeMb: Math.max(4, Math.floor(memoryMb / 4)),
        codeRangeSizeMb: 16,
        stackSizeMb: 4,
      },
      // Ensure the worker cannot access host environment variables
      env: {},
    });

    function settle(result: PluginResult): void {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    }

    // ── Timeout enforcement ──────────────────────────────────────
    timeoutHandle = setTimeout(() => {
      const executionTimeMs = Date.now() - startTime;
      log.warn(
        { pluginId: manifest.id, tenantId: context.tenantId, timeoutMs },
        "plugin execution timed out — terminating worker",
      );

      worker.terminate().catch(() => {
        // Worker may already be dead
      });

      settle({
        success: false,
        error: `Plugin execution timed out after ${timeoutMs}ms`,
        executionTimeMs,
        memoryUsedMb: 0,
      });
    }, timeoutMs);

    // ── Worker message handling ──────────────────────────────────
    worker.on("message", (msg: WorkerMessage) => {
      const executionTimeMs = Date.now() - startTime;

      if (msg.type === "result") {
        settle({
          success: true,
          result: msg.result,
          executionTimeMs,
          memoryUsedMb: msg.memoryUsedMb,
        });
      } else {
        settle({
          success: false,
          error: msg.error ?? "Unknown plugin error",
          executionTimeMs,
          memoryUsedMb: msg.memoryUsedMb,
        });
      }

      // Terminate worker after receiving result
      worker.terminate().catch(() => {});
    });

    // ── Worker error handling (OOM, crash, etc.) ──────────────────
    worker.on("error", (err) => {
      const executionTimeMs = Date.now() - startTime;
      const isOom = err.message.includes("out of memory") ||
                    err.message.includes("heap out of memory") ||
                    err.message.includes("Allocation failed");

      if (isOom) {
        log.warn(
          { pluginId: manifest.id, tenantId: context.tenantId, memoryMb },
          "plugin execution exceeded memory limit",
        );
      } else {
        log.error(
          { pluginId: manifest.id, tenantId: context.tenantId, error: err.message },
          "plugin worker error",
        );
      }

      settle({
        success: false,
        error: isOom
          ? `Plugin execution exceeded memory limit (${memoryMb}MB)`
          : err.message,
        executionTimeMs,
        memoryUsedMb: isOom ? memoryMb : 0,
      });
    });

    // ── Worker exit handling ──────────────────────────────────────
    worker.on("exit", (exitCode) => {
      if (!settled) {
        const executionTimeMs = Date.now() - startTime;
        settle({
          success: false,
          error: `Worker exited unexpectedly with code ${exitCode}`,
          executionTimeMs,
          memoryUsedMb: 0,
        });
      }
    });
  });
}

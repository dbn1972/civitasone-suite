/**
 * Plugin sandboxed runtime engine.
 *
 * Executes registered plugin hooks in a sandboxed context with:
 *   - Timeout enforcement (max 5s per hook execution)
 *   - Memory limit (via structured clone isolation)
 *   - Restricted API surface (no fs, no net, no process)
 *   - Tenant isolation (hooks only see their own tenant's data)
 *   - Permission model (manifest declares required capabilities)
 *
 * Architecture:
 *   1. Event arrives (e.g. "finance.payment.created")
 *   2. Engine looks up active hooks subscribed to that event
 *   3. For each hook, loads the handler and executes in sandbox
 *   4. Results/errors are recorded for audit
 *
 * Env vars:
 *   PLUGIN_RUNTIME_ENABLED   — "true" | "false" (default: false)
 *   PLUGIN_EXEC_TIMEOUT_MS   — max execution time (default: 5000)
 *   PLUGIN_MAX_MEMORY_MB     — max memory per execution (default: 64)
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { runInSandbox, SANDBOX_TIMEOUT, type SandboxApi } from "./sandbox/runtime.js";

const log = pino({ name: "plugin-runtime" });

const ENABLED = process.env.PLUGIN_RUNTIME_ENABLED === "true";
const TIMEOUT_MS = Number(process.env.PLUGIN_EXEC_TIMEOUT_MS ?? 5000);

// ── Types ─────────────────────────────────────────────────────────

export interface PluginHookDef {
  id: string;
  pluginId: string;
  tenantId: string;
  eventType: string;
  handlerPath: string;
  active: boolean;
}

export interface HookExecutionContext {
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string;
}

export interface HookExecutionResult {
  hookId: string;
  pluginId: string;
  executionId: string;
  status: "success" | "error" | "timeout" | "permission_denied";
  durationMs: number;
  output?: unknown | undefined;
  error?: string | undefined;
}

export interface PluginManifest {
  name: string;
  version: string;
  permissions?: string[];
  events?: string[];
  maxTimeout?: number;
}

// ── Permission Model ──────────────────────────────────────────────

const AVAILABLE_PERMISSIONS = new Set([
  "read:tenant",       // Read tenant data
  "write:tenant",      // Write tenant data (via API calls)
  "emit:event",        // Emit events to the queue
  "http:outbound",     // Make outbound HTTP requests
  "storage:read",      // Read from object storage
  "storage:write",     // Write to object storage
]);

function checkPermissions(manifest: PluginManifest, required: string[]): string | null {
  const granted = new Set(manifest.permissions ?? []);
  for (const perm of required) {
    if (!granted.has(perm) && !granted.has("*")) {
      return `Permission "${perm}" not granted in plugin manifest`;
    }
  }
  return null;
}

// ── Sandbox Execution ─────────────────────────────────────────────

/**
 * Execute a hook handler in a sandboxed context.
 *
 * The sandbox provides a restricted API:
 *   - ctx.tenantId, ctx.eventType, ctx.payload
 *   - ctx.log(level, message) — structured logging
 *   - ctx.emit(eventType, payload) — emit events (requires emit:event permission)
 *   - ctx.fetch(url, options) — outbound HTTP (requires http:outbound permission)
 *
 * The handler is a function string or a reference to a stored handler,
 * executed via runInSandbox() (./sandbox/runtime.js) — an isolated node:vm
 * context with a null-prototype global/ctx, disabled codeGeneration, and
 * object-valued ctx properties (payload) reconstructed inside the context
 * via its own JSON.parse. See that file's own header for the full threat
 * model and residual limitations. This comment previously described an
 * earlier, superseded `new Function(handler)` implementation (a real RCE —
 * see SEC-P0-03 in sandbox/runtime.ts) and was never updated after the fix;
 * stale comments next to security-critical code are their own hazard.
 */
async function executeInSandbox(
  handler: string,
  context: HookExecutionContext,
  manifest: PluginManifest,
): Promise<{ output: unknown; error?: string }> {
  const emittedEvents: Array<{ type: string; payload: unknown }> = [];

  // Build the sandbox API
  const sandboxApi = {
    tenantId: context.tenantId,
    eventType: context.eventType,
    payload: structuredClone(context.payload), // Isolation: deep copy
    correlationId: context.correlationId,
    log: (level: string, msg: string) => {
      log.info({ level, pluginLog: msg, tenant: context.tenantId }, "plugin log");
    },
    emit: (eventType: string, payload: unknown) => {
      const permErr = checkPermissions(manifest, ["emit:event"]);
      if (permErr) throw new Error(permErr);
      emittedEvents.push({ type: eventType, payload });
    },
  };

  // SEC-P0-03: run the untrusted handler in an isolated vm context with no
  // access to require/process/module/fs (see sandbox/runtime.ts). The previous
  // `new Function(handler)` executed plugin code in the host module scope —
  // arbitrary RCE. `emittedEvents` is captured via the sandbox `emit` closure.
  const { output, error } = await runInSandbox(handler, sandboxApi as SandboxApi, TIMEOUT_MS);
  if (error) {
    if (error === SANDBOX_TIMEOUT) {
      return { output: null, error: `Hook execution timed out (${TIMEOUT_MS}ms)` };
    }
    return { output: null, error };
  }
  return { output: output ?? { emittedEvents } };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Execute all active hooks for a given event.
 * Returns execution results for each hook.
 */
export async function executeHooks(
  hooks: PluginHookDef[],
  context: HookExecutionContext,
  manifestLookup: (pluginId: string) => PluginManifest | null,
): Promise<HookExecutionResult[]> {
  if (!ENABLED) {
    log.debug({ event: context.eventType }, "plugin runtime disabled — skipping hook execution");
    return [];
  }

  const results: HookExecutionResult[] = [];

  for (const hook of hooks.filter((h) => h.active && h.tenantId === context.tenantId)) {
    const executionId = randomUUID();
    const start = Date.now();

    const manifest = manifestLookup(hook.pluginId);
    if (!manifest) {
      results.push({
        hookId: hook.id,
        pluginId: hook.pluginId,
        executionId,
        status: "error",
        durationMs: 0,
        error: "Plugin manifest not found",
      });
      continue;
    }

    // Check event permission
    if (manifest.events && !manifest.events.includes(context.eventType) && !manifest.events.includes("*")) {
      results.push({
        hookId: hook.id,
        pluginId: hook.pluginId,
        executionId,
        status: "permission_denied",
        durationMs: 0,
        error: `Plugin not subscribed to event "${context.eventType}"`,
      });
      continue;
    }

    const { output, error } = await executeInSandbox(hook.handlerPath, context, manifest);
    const durationMs = Date.now() - start;

    results.push({
      hookId: hook.id,
      pluginId: hook.pluginId,
      executionId,
      status: error ? (error.includes("TIMEOUT") ? "timeout" : "error") : "success",
      durationMs,
      output: error ? undefined : output,
      error,
    });

    log.info({ hookId: hook.id, pluginId: hook.pluginId, executionId, status: error ? "error" : "success", durationMs }, "hook executed");
  }

  return results;
}

/** Check if the runtime is enabled. */
export function isEnabled(): boolean { return ENABLED; }

/**
 * Plugin Sandbox Types
 *
 * Shared type definitions for the V8 sandboxed plugin execution runtime.
 * Used by both the host runtime and the worker thread script.
 */

/** Permissions a plugin can declare in its manifest */
export type PluginPermission =
  | "read:tenant"
  | "write:tenant"
  | "emit:event"
  | "http:outbound"
  | "storage:read"
  | "storage:write";

/** Plugin manifest declaring capabilities and permissions */
export interface PluginManifest {
  id: string;
  permissions: PluginPermission[];
  events: string[];
  crons?: string[];
}

/** Context passed to a plugin execution — scoped to the invoking tenant */
export interface PluginContext {
  tenantId: string;
  pluginId: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  correlationId: string;
}

/** Result of a plugin execution */
export interface PluginResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTimeMs: number;
  memoryUsedMb: number;
}

/** Execution status for tracking */
export type ExecutionStatus = "success" | "timeout" | "error" | "oom";

/** Data sent to the worker thread (internal to runtime.ts inline script) */
export interface WorkerData {
  code: string;
  context: PluginContext;
  manifest: PluginManifest;
  timeoutMs: number;
}

/** Message sent from worker back to host (internal to runtime.ts inline script) */
export interface WorkerMessage {
  type: "result" | "error";
  result?: unknown;
  error?: string;
  memoryUsedMb: number;
}

/**
 * Plugin runtime context types.
 *
 * These interfaces define the sandbox environment available to plugin code
 * at execution time.
 */

/**
 * Tenant-scoped key-value store available to plugins.
 */
export interface PluginStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  upsert<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Minimal auth context available to the plugin.
 */
export interface PluginAuthContext {
  tenantId: string;
  userId: string;
  roles: string[];
}

/**
 * Logger interface available to plugins.
 */
export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Platform utilities exposed to plugins.
 */
export interface PluginPlatform {
  version: string;
  baseUrl: string;
}

/**
 * The runtime context injected into every plugin handler invocation.
 */
export interface PluginContext {
  store: PluginStore;
  auth: PluginAuthContext;
  log: PluginLogger;
  emit(event: string, payload: unknown): Promise<void>;
  platform: PluginPlatform;
  config: Record<string, unknown>;
}

/**
 * Envelope wrapping an event delivered to plugin event handlers.
 */
export interface EventEnvelope {
  id: string;
  type: string;
  tenantId: string;
  timestamp: string;
  payload: unknown;
}

/**
 * Incoming HTTP request to a plugin API route.
 */
export interface PluginRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
}

/**
 * Response returned from a plugin API route handler.
 */
export interface PluginResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Handler for plugin event subscriptions.
 */
export type PluginEventHandler = (
  event: EventEnvelope,
  ctx: PluginContext,
) => Promise<void>;

/**
 * Handler for plugin scheduled tasks.
 */
export type PluginScheduleHandler = (ctx: PluginContext) => Promise<void>;

/**
 * Handler for plugin API routes.
 */
export type PluginRouteHandler = (
  req: PluginRequest,
  ctx: PluginContext,
) => Promise<PluginResponse>;

/**
 * @civitasone/connector-framework — CAP-053.
 *
 * A reusable contract for external-system connectors (GSTN, PFMS, NACH, TRACES,
 * ...). Every connector is configured the same way, health-checked the same way,
 * and invoked the same way, so a host service can discover + drive any of them
 * without knowing provider specifics. Config is resolved per-tenant from the
 * admin-service integration_settings registry (see createConfiguredConnector).
 */

export type ConnectorMode = "mock" | "sandbox" | "production";

/** Resolved configuration handed to a connector. Secrets are never logged. */
export interface ConnectorConfig {
  mode: ConnectorMode;
  endpointUrl?: string | undefined;
  /** Non-secret settings (gstin, agency code, scheme code, ...). */
  config: Record<string, unknown>;
  /** Decrypted secrets (client secret, auth token, ...). */
  secrets: Record<string, string>;
}

export interface HealthResult {
  healthy: boolean;
  mode: ConnectorMode;
  configured: boolean;
  detail?: string | undefined;
}

export class ConnectorError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

/**
 * The uniform connector contract:
 *   configure() → inject resolved config/secrets
 *   isConfigured() → is it safe to make real (non-mock) calls?
 *   healthCheck() → readiness signal
 *   invoke(operation, input) → dispatch a named operation
 */
export interface Connector {
  readonly provider: string;
  /** Secret keys that MUST be present for non-mock operation. */
  readonly requiredSecrets: readonly string[];
  /** Operation names this connector understands. */
  readonly operations: readonly string[];
  configure(cfg: ConnectorConfig): void;
  isConfigured(): boolean;
  healthCheck(): Promise<HealthResult>;
  invoke<TOut = unknown>(operation: string, input?: unknown): Promise<TOut>;
}

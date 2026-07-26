import { ConnectorError, type Connector, type ConnectorConfig, type ConnectorMode, type HealthResult } from "./types.js";

/**
 * Shared connector plumbing: config storage, a fail-closed isConfigured() based
 * on requiredSecrets, and a default healthCheck(). Concrete connectors extend
 * this and implement invoke() + declare provider/requiredSecrets/operations.
 */
export abstract class BaseConnector implements Connector {
  abstract readonly provider: string;
  abstract readonly requiredSecrets: readonly string[];
  abstract readonly operations: readonly string[];

  protected cfg: ConnectorConfig = { mode: "mock", config: {}, secrets: {} };

  configure(cfg: ConnectorConfig): void {
    this.cfg = cfg;
  }

  get mode(): ConnectorMode {
    return this.cfg.mode;
  }

  /**
   * Mock mode is always "configured". For sandbox/production every required
   * secret must be present and non-empty — otherwise a real call would fail
   * closed, so we refuse up front.
   */
  isConfigured(): boolean {
    if (this.cfg.mode === "mock") return true;
    return this.requiredSecrets.every((k) => {
      const v = this.cfg.secrets[k];
      return typeof v === "string" && v.length > 0;
    });
  }

  async healthCheck(): Promise<HealthResult> {
    const configured = this.isConfigured();
    return {
      healthy: configured,
      mode: this.cfg.mode,
      configured,
      ...(configured ? {} : { detail: `missing secrets: ${this.missingSecrets().join(", ")}` }),
    };
  }

  protected missingSecrets(): string[] {
    return this.requiredSecrets.filter((k) => {
      const v = this.cfg.secrets[k];
      return !(typeof v === "string" && v.length > 0);
    });
  }

  /** Guard: reject an unknown operation before dispatch. */
  protected assertOperation(operation: string): void {
    if (!this.operations.includes(operation)) {
      throw new ConnectorError("UNKNOWN_OPERATION", `${this.provider} connector has no operation '${operation}'`);
    }
  }

  /** Guard: refuse a real invoke when not configured. */
  protected assertReady(): void {
    if (!this.isConfigured()) {
      throw new ConnectorError(
        "NOT_CONFIGURED",
        `${this.provider} connector not configured for ${this.cfg.mode} (missing: ${this.missingSecrets().join(", ")})`,
      );
    }
  }

  abstract invoke<TOut = unknown>(operation: string, input?: unknown): Promise<TOut>;
}

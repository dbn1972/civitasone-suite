import { resolveIntegration } from "@civitasone/integration-config";
import { ConnectorError, type Connector, type ConnectorConfig, type ConnectorMode } from "./types.js";

export type ConnectorFactory = () => Connector;

const REGISTRY = new Map<string, ConnectorFactory>();

export function registerConnector(provider: string, factory: ConnectorFactory): void {
  REGISTRY.set(provider, factory);
}

export function getConnectorFactory(provider: string): ConnectorFactory | undefined {
  return REGISTRY.get(provider);
}

export function listConnectorProviders(): string[] {
  return [...REGISTRY.keys()];
}

/** A fresh, unconfigured connector instance, or undefined when unregistered. */
export function createConnector(provider: string): Connector | undefined {
  return REGISTRY.get(provider)?.();
}

export interface ConfiguredConnectorOpts {
  tenantId: string;
  envScope?: string;
  /** Used when the integration_settings registry is not wired for this tenant. */
  fallback?: Partial<ConnectorConfig>;
}

/**
 * Instantiate a connector and configure it from the admin-service
 * integration_settings registry (via @civitasone/integration-config). When the
 * registry is not wired for this tenant, fall back to the caller's `fallback`
 * (default: mock mode) so local/dev environments still work — never fabricating
 * production credentials.
 */
export async function createConfiguredConnector(
  provider: string,
  opts: ConfiguredConnectorOpts,
): Promise<Connector> {
  const factory = REGISTRY.get(provider);
  if (!factory) throw new ConnectorError("UNKNOWN_CONNECTOR", `no connector registered for '${provider}'`);
  const connector = factory();

  const resolved = await resolveIntegration({
    provider,
    tenantId: opts.tenantId,
    ...(opts.envScope ? { envScope: opts.envScope } : {}),
  });

  const cfg: ConnectorConfig = resolved
    ? {
        mode: normalizeMode(resolved.config.mode) ?? "production",
        endpointUrl: resolved.endpointUrl,
        config: resolved.config,
        secrets: resolved.secrets,
      }
    : {
        mode: normalizeMode(opts.fallback?.mode) ?? "mock",
        endpointUrl: opts.fallback?.endpointUrl,
        config: opts.fallback?.config ?? {},
        secrets: opts.fallback?.secrets ?? {},
      };

  connector.configure(cfg);
  return connector;
}

function normalizeMode(v: unknown): ConnectorMode | undefined {
  return v === "mock" || v === "sandbox" || v === "production" ? v : undefined;
}

/**
 * Platform-integration adapter ports (eSign, DSC, bank API, PFMS).
 *
 * These are the typed seams a downstream flow (document eSign, DSC signing,
 * bank payment-file submission) codes against. Every port has:
 *   - a MOCK adapter (sandbox): deterministic, in-memory, realistic enough to
 *     exercise a flow end-to-end in dev and UAT. Clearly labelled mock.
 *   - a REAL adapter STUB (production): throws NotImplementedError carrying the
 *     provider name. No real provider endpoint or wire protocol is invented
 *     here; the actual integrations are built during UAT.
 *
 * The package carries NO runtime dependencies so any service can import it.
 */

export type PlatformIntegrationCategory = "esign" | "dsc" | "bank_api" | "pfms" | "ocr";
export type AdapterEnvironment = "sandbox" | "production";

/** Everything an adapter needs to run, already decrypted by the caller. */
export interface AdapterContext {
  /** Catalogue provider key, e.g. "esign_nsdl_egov". */
  providerKey: string;
  /** Human provider name, used in error messages. */
  providerName: string;
  environment: AdapterEnvironment;
  /** Non-secret tenant config values (schema-defined). */
  config: Record<string, unknown>;
  /** Decrypted secret values. Adapters must never log or return these. */
  secrets: Record<string, string>;
  /** Catalogue endpoint for this environment, when the platform set one. */
  endpointUrl?: string | undefined;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Stable machine code: OK | CONFIG_INCOMPLETE | AUTH_FAILED | TIMEOUT | PROVIDER_REJECTED. */
  code: string;
  message: string;
  latencyMs: number;
  /** True for every sandbox mock result so no reader mistakes it for a live handshake. */
  mock: boolean;
}

export interface IntegrationAdapter {
  readonly providerKey: string;
  readonly mock: boolean;
  testConnection(): Promise<ConnectionTestResult>;
}

/** Thrown by every real-adapter stub. Carries the provider name. */
export class NotImplementedError extends Error {
  readonly code = "NOT_IMPLEMENTED";
  constructor(public readonly providerName: string, public readonly operation: string) {
    super(`${providerName}: ${operation} is not implemented yet (real adapter pending UAT integration)`);
    this.name = "NotImplementedError";
  }
}

/** Sandbox scenario a tester can pick on the integration form to exercise failure paths. */
export const SANDBOX_SCENARIOS = ["success", "auth_failed", "timeout", "provider_rejected"] as const;
export type SandboxScenario = (typeof SANDBOX_SCENARIOS)[number];

export function readScenario(config: Record<string, unknown>): SandboxScenario {
  const v = config["sandboxScenario"];
  return (SANDBOX_SCENARIOS as readonly string[]).includes(v as string) ? (v as SandboxScenario) : "success";
}

/** FNV-1a 32-bit, hex. Deterministic id material for mocks (not a security hash). */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

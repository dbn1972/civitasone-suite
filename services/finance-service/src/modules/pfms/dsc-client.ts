import { createDscSigner, type AdapterContext, type DscSigner } from "@civitasone/connector-framework/ports";

/**
 * Resolves the tenant's DSC signer (GAP-FINANCE-PFMS-01).
 *
 * The tenant's DSC integration (provider + sandbox|production) is configured in the admin-service platform
 * integrations module. This service never reads that database: it asks admin-service over the internal
 * service path (x-internal + x-service-secret + x-tenant-id) for a NON-SECRET descriptor, then builds the
 * adapter with the connector-framework factory: the sandbox MOCK in sandbox, the production stub otherwise.
 * Secret values stay in admin-service; the real production adapter, which will need them, is a UAT item.
 */

const ADMIN_URL = process.env.ADMIN_SERVICE_URL ?? "http://127.0.0.1:3022";

export class DscChannelError extends Error {
  constructor(
    public readonly code: "DSC_NOT_CONFIGURED" | "DSC_CONFIG_UNAVAILABLE" | "DSC_PRODUCTION_UNAVAILABLE" | "DSC_SIGN_REJECTED",
    message: string,
    /** Permanent errors are recorded and not retried; transient ones are retried by the queue. */
    public readonly permanent: boolean,
  ) {
    super(message);
    this.name = "DscChannelError";
  }
}

export interface DscDescriptor {
  providerKey: string;
  providerName: string;
  environment: "sandbox" | "production";
  config: Record<string, unknown>;
  endpointUrl: string | null;
}

/** A deployed production process (NODE_ENV=production) must never fall back to a sandbox signer on its own. */
export const isProductionDeployment = (): boolean => process.env.NODE_ENV === "production";

export async function fetchDscDescriptor(tenantId: string): Promise<DscDescriptor | null> {
  let res: Response;
  try {
    res = await fetch(`${ADMIN_URL}/v1/admin/platform-integrations/internal/active/dsc`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId, "x-internal-caller": "finance-service" },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new DscChannelError("DSC_CONFIG_UNAVAILABLE", `DSC integration config could not be reached: ${err instanceof Error ? err.message : "unknown error"}`, false);
  }
  if (!res.ok) throw new DscChannelError("DSC_CONFIG_UNAVAILABLE", `DSC integration config lookup failed (HTTP ${res.status})`, false);
  const body = (await res.json()) as { data: (DscDescriptor & { secretKeysSet?: string[] }) | null };
  if (!body.data) return null;
  const d = body.data;
  return { providerKey: d.providerKey, providerName: d.providerName, environment: d.environment, config: d.config ?? {}, endpointUrl: d.endpointUrl ?? null };
}

export interface ResolvedSigner {
  signer: DscSigner;
  providerKey: string;
  environment: "sandbox" | "production";
  /** True when the signature will come from the MOCK signer (labelled in the UI and audit; never a legal signature). */
  mock: boolean;
  /** Signing identity reference: certificate thumbprint (token bridge) or key label (HSM). A reference, never key material. */
  signerRef: string;
}

export function signerRefFor(config: Record<string, unknown>, providerKey: string): string {
  for (const k of ["certificateThumbprint", "keyLabel"]) {
    const v = config[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return `${providerKey}:default`;
}

export async function resolveDscSigner(tenantId: string, fetchDescriptor: typeof fetchDscDescriptor = fetchDscDescriptor): Promise<ResolvedSigner> {
  const d = await fetchDescriptor(tenantId);
  if (!d) {
    if (isProductionDeployment()) {
      throw new DscChannelError("DSC_NOT_CONFIGURED", "no DSC integration is configured for this tenant; configure one in Platform Integrations before signing", true);
    }
    // Local/dev/test only: a clearly-labelled sandbox mock so the flow can be exercised without tenant setup.
    const ctx: AdapterContext = { providerKey: "dsc_sandbox_default", providerName: "Sandbox DSC signer (mock)", environment: "sandbox", config: {}, secrets: {} };
    const signer = createDscSigner(ctx);
    return { signer, providerKey: ctx.providerKey, environment: "sandbox", mock: signer.mock, signerRef: signerRefFor({}, ctx.providerKey) };
  }
  const ctx: AdapterContext = {
    providerKey: d.providerKey,
    providerName: d.providerName,
    environment: d.environment,
    config: d.config,
    secrets: {},
    ...(d.endpointUrl ? { endpointUrl: d.endpointUrl } : {}),
  };
  const signer = createDscSigner(ctx);
  return { signer, providerKey: d.providerKey, environment: d.environment, mock: signer.mock, signerRef: signerRefFor(d.config, d.providerKey) };
}

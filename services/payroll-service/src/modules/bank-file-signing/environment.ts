/**
 * Which environment a tenant's bank integrations run in. `none` (unsigned
 * bank files) is refused in production.
 *
 * SEAM: a per-tenant integration environment will come from the platform /
 * tenant integrations config (bank_api provider). Until that lands, the
 * environment is the PAYROLL_INTEGRATION_ENVIRONMENT variable
 * ("production" | "sandbox" | "dev"); NODE_ENV=production always counts as
 * production regardless. Both checks are OR-ed -- either one refuses `none`.
 */
export type IntegrationEnvironment = "production" | "sandbox" | "dev";

export type IntegrationEnvironmentResolver = (tenantId: string) => Promise<IntegrationEnvironment>;

/** Environment named by PAYROLL_INTEGRATION_ENVIRONMENT (default "dev"). */
export function integrationEnvironmentFromEnv(): IntegrationEnvironment {
  const v = (process.env.PAYROLL_INTEGRATION_ENVIRONMENT ?? "").trim().toLowerCase();
  if (v === "production" || v === "prod") return "production";
  if (v === "sandbox" || v === "uat") return "sandbox";
  return "dev";
}

/** NODE_ENV=production or PAYROLL_INTEGRATION_ENVIRONMENT=production (process-wide, sync). */
export function isProductionProcess(): boolean {
  return (process.env.NODE_ENV ?? "") === "production" || integrationEnvironmentFromEnv() === "production";
}

const envResolver: IntegrationEnvironmentResolver = async () => integrationEnvironmentFromEnv();

let resolver: IntegrationEnvironmentResolver = envResolver;

/** Wire the real per-tenant resolver (platform integrations) here. */
export function setIntegrationEnvironmentResolver(r: IntegrationEnvironmentResolver | null): void {
  resolver = r ?? envResolver;
}

/** True when unsigned bank files must be refused for this tenant. */
export async function isProductionFor(tenantId: string): Promise<boolean> {
  if ((process.env.NODE_ENV ?? "") === "production") return true;
  return (await resolver(tenantId)) === "production";
}

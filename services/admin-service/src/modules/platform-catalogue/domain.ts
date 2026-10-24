/**
 * platform-catalogue -- pure view mapping for the three superadmin read screens
 * /admin/editions, /admin/entitlements and /admin/gateways (COMP-020).
 *
 * Wire contracts (derived from the web loaders + models, not invented):
 *   editions     -> apps/web/src/lib/admin/monitoring.ts EditionRow
 *                   { name, modulesIncluded, pricing, tenants, status }
 *   entitlements -> apps/web/src/app/(app)/admin/entitlements/entitlementModel.ts
 *                   { module, edition, tenant, limit, used, status }
 *   gateways     -> apps/web/src/app/(app)/admin/gateways/gatewayModel.ts
 *                   { type, provider, messagesPerDay, successRate, lastChecked, status }
 * Figures the platform does not track (edition pricing, per-module caps and usage,
 * messages/day and delivery success per gateway) are null / empty, never fabricated.
 */

export interface EditionSource {
  code: string;
  label: string;
  subtitle: string;
  defaultModules: string[];
}

export interface EditionView {
  code: string;
  name: string;
  subtitle: string;
  /** Count of modules the edition grants by default (the screen renders it as-is). */
  modulesIncluded: number;
  modules: string[];
  /** No pricing store exists in the platform: always null. */
  pricing: null;
  tenants: number;
  status: "active";
}

export function toEditionView(src: EditionSource, tenants: number): EditionView {
  return {
    code: src.code,
    name: src.label,
    subtitle: src.subtitle,
    modulesIncluded: src.defaultModules.length,
    modules: [...src.defaultModules],
    pricing: null,
    tenants,
    status: "active",
  };
}

export interface EntitlementView {
  module: string;
  moduleId: string;
  edition: string;
  /** Tenant name for a tenant override; empty for the edition-wide default. */
  tenant: string;
  tenantId: string | null;
  /** No per-module cap store exists: empty string = unlimited / untracked. */
  limit: string;
  /** No per-module usage metering is joined here: empty string = untracked. */
  used: string;
  status: "active";
}

export function editionEntitlement(edition: string, moduleId: string, moduleName: string): EntitlementView {
  return { module: moduleName, moduleId, edition, tenant: "", tenantId: null, limit: "", used: "", status: "active" };
}

export function tenantOverride(
  edition: string, moduleId: string, moduleName: string, tenantId: string, tenantName: string,
): EntitlementView {
  return { module: moduleName, moduleId, edition, tenant: tenantName, tenantId, limit: "", used: "", status: "active" };
}

/** The four communication providers in the integration-settings registry. */
export const GATEWAY_PROVIDERS = [
  { provider: "sms_twilio", type: "SMS" },
  { provider: "whatsapp_meta", type: "WhatsApp" },
  { provider: "email_smtp", type: "Email" },
  { provider: "push_fcm", type: "Push" },
] as const;

export type GatewayStatus = "active" | "degraded" | "down" | "standby";

export interface GatewayAggregate {
  /** Tenants with this provider enabled. */
  enabled: number;
  connected: number;
  failed: number;
  lastTestedAt: Date | null;
}

/**
 * standby  : no tenant has it enabled with a passing/failing test -- nothing to report on.
 * active   : at least one connected, none failed.
 * degraded : some connected, some failed.
 * down     : enabled, none connected, at least one failed.
 */
export function gatewayStatus(a: GatewayAggregate): GatewayStatus {
  if (a.failed > 0) return a.connected > 0 ? "degraded" : "down";
  if (a.connected > 0) return "active";
  return "standby";
}

export interface GatewayView {
  type: string;
  provider: string;
  providerKey: string;
  /** Delivery volume lives in notification-service per tenant; not aggregated here. */
  messagesPerDay: null;
  /** Connection-test outcomes are not message delivery rates; not reported as one. */
  successRate: null;
  lastChecked: string | null;
  status: GatewayStatus;
  tenantsEnabled: number;
  tenantsConnected: number;
  tenantsFailed: number;
}

export function toGatewayView(type: string, providerKey: string, providerLabel: string, a: GatewayAggregate): GatewayView {
  return {
    type,
    provider: providerLabel,
    providerKey,
    messagesPerDay: null,
    successRate: null,
    lastChecked: a.lastTestedAt ? a.lastTestedAt.toISOString() : null,
    status: gatewayStatus(a),
    tenantsEnabled: a.enabled,
    tenantsConnected: a.connected,
    tenantsFailed: a.failed,
  };
}

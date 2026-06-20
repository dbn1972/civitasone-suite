export type ServiceHealth = { service: string; status: string; httpStatus?: number };
export type AggregateHealth = { status: "ok" | "degraded" | "down"; services: ServiceHealth[]; checkedAt: string };

/** 2 healthy + 1 unhealthy → degraded; all down → down; all ok → ok. */
export function aggregateHealth(results: ServiceHealth[]): AggregateHealth {
  const okCount = results.filter((r) => r.status === "ok").length;
  const downCount = results.filter((r) => r.status !== "ok").length;
  let status: AggregateHealth["status"] = "ok";
  if (downCount > 0 && okCount > 0) status = "degraded";
  else if (okCount === 0 && results.length > 0) status = "down";
  return { status, services: results, checkedAt: new Date().toISOString() };
}

/** All 18 auth-wired services with default listen ports (override via PORT env in each service). */
export const DEFAULT_SERVICES: Array<{ name: string; port: number }> = [
  { name: "identity-service",     port: 3001 },
  { name: "policy-service",       port: 3003 },
  { name: "audit-service",        port: 3004 },
  { name: "notification-service", port: 3006 },
  { name: "finance-service",      port: 3007 },
  { name: "procurement-service",  port: 3008 },
  { name: "contract-service",     port: 3009 },
  { name: "estab-service",        port: 3010 },
  { name: "asset-service",        port: 3010 },
  { name: "stock-service",        port: 3011 },
  { name: "project-service",      port: 3011 },
  { name: "hrms-service",         port: 3012 },
  { name: "payroll-service",      port: 3013 },
  { name: "grant-service",        port: 3019 },
  { name: "citizen-service",      port: 3020 },
  { name: "legal-service",        port: 3021 },
  { name: "admin-service",        port: 3022 },
  { name: "billing-service",      port: 3023 },
];

/** Service registry — prefix → upstream (env override per service). */
export type ServiceRoute = {
  name: string;
  prefix: string;
  upstream: string;
  /** Path on upstream service (defaults to same as prefix without /api) */
  upstreamPath?: string;
};

function upstream(name: string, port: number): string {
  const envKey = `GATEWAY_${name.toUpperCase().replace(/-/g, "_")}_URL`;
  return process.env[envKey] ?? `http://127.0.0.1:${port}`;
}

export const SERVICE_ROUTES: ServiceRoute[] = [
  { name: "identity",     prefix: "/api/identity",     upstream: upstream("identity", 3001) },
  { name: "policy",       prefix: "/api/policy",       upstream: upstream("policy", 3003) },
  { name: "policy-v1",   prefix: "/api/v1/policy",    upstream: upstream("policy", 3003) },
  { name: "audit-events", prefix: "/api/audit",        upstream: upstream("audit", 3004) },
  { name: "audit",        prefix: "/api/v1/audit",     upstream: upstream("audit", 3004) },
  { name: "notification", prefix: "/api/notification", upstream: upstream("notification", 3006), upstreamPath: "/notifications" },
  { name: "finance",      prefix: "/api/v1/finance",   upstream: upstream("finance", 3007) },
  { name: "procurement",  prefix: "/api/v1/procurement", upstream: upstream("procurement", 3008) },
  { name: "contract",     prefix: "/api/v1/contract",  upstream: upstream("contract", 3009) },
  { name: "estab",        prefix: "/api/v1/estab",     upstream: upstream("estab", 3010) },
  { name: "establishment", prefix: "/api/v1/establishment", upstream: upstream("estab", 3010) },
  { name: "stock",        prefix: "/api/v1/stock",     upstream: upstream("stock", 3011) },
  { name: "hrms",         prefix: "/api/v1/hrms",      upstream: upstream("hrms", 3012) },
  { name: "hr",           prefix: "/api/v1/hr",        upstream: upstream("hrms", 3012), upstreamPath: "/v1/hrms" },
  { name: "careers",      prefix: "/api/v1/careers",   upstream: upstream("hrms", 3012) },
  { name: "payroll",      prefix: "/api/v1/payroll",   upstream: upstream("payroll", 3013) },
  { name: "project",      prefix: "/api/v1/project", upstream: upstream("project", 3014), upstreamPath: "/v1/projects" },
  { name: "projects",     prefix: "/api/v1/projects",  upstream: upstream("project", 3014), upstreamPath: "/v1/projects" },
  { name: "asset",        prefix: "/api/v1/asset",     upstream: upstream("asset", 3015), upstreamPath: "/v1/assets" },
  { name: "assets",       prefix: "/api/v1/assets",    upstream: upstream("asset", 3015), upstreamPath: "/v1/assets" },
  { name: "grant",        prefix: "/api/v1/grants",    upstream: upstream("grant", 3019) },
  { name: "grant-alias",  prefix: "/api/v1/grant",     upstream: upstream("grant", 3019) },
  { name: "citizen",      prefix: "/api/v1/citizen",   upstream: upstream("citizen", 3020) },
  { name: "legal",        prefix: "/api/v1/legal",     upstream: upstream("legal", 3021) },
  { name: "admin-users",  prefix: "/api/v1/admin/users", upstream: upstream("identity", 3001), upstreamPath: "/identity/users" },
  { name: "admin",        prefix: "/api/v1/admin",     upstream: upstream("admin", 3022) },
  { name: "billing",      prefix: "/api/v1/billing",   upstream: upstream("billing", 3023) },
  { name: "crm",          prefix: "/api/v1/crm",       upstream: upstream("crm", 3024) },
  { name: "install",      prefix: "/api/v1/install",   upstream: upstream("install", 3005) },
  { name: "plugin",       prefix: "/api/v1/plugins",   upstream: upstream("plugin", 3017) },
  { name: "theme",        prefix: "/api/v1/themes",    upstream: upstream("theme", 3018) },
  { name: "reports",      prefix: "/api/v1/reports",   upstream: upstream("report", 3016) },
  { name: "inventory",    prefix: "/api/v1/inventory", upstream: upstream("inventory", 3025) },
  { name: "telephony",    prefix: "/api/v1/telephony", upstream: upstream("telephony", 3026) },
  { name: "helpdesk",     prefix: "/api/v1/helpdesk",  upstream: upstream("helpdesk", 3027) },
  { name: "knowledge",    prefix: "/api/v1/knowledge", upstream: upstream("knowledge", 3028) },
  { name: "workflow",     prefix: "/api/v1/workflow",  upstream: upstream("workflow", 3029) },
  { name: "analytics",    prefix: "/api/v1/analytics", upstream: upstream("analytics", 3031) },
  { name: "ml",           prefix: "/api/v1/ml",        upstream: upstream("ml", 3032) },
  { name: "meeting",      prefix: "/api/v1/meeting",   upstream: upstream("meeting", 3033), upstreamPath: "/v1/meetings" },
  { name: "court",        prefix: "/api/v1/court",     upstream: upstream("court", 3034) },
  { name: "courts",       prefix: "/api/v1/courts",    upstream: upstream("court", 3034), upstreamPath: "/v1/court" },
  { name: "visitor",     prefix: "/api/v1/visitor",   upstream: upstream("visitor", 3035) },
  { name: "inspection",  prefix: "/api/v1/inspection", upstream: upstream("inspection", 3037) },
  { name: "works",       prefix: "/api/v1/works",    upstream: upstream("works", 3036) },
  // Previously absent: both services were built and tested but had NO gateway
  // route, so every request 404'd and no client could reach them. revenue-service
  // has the fleet's highest line coverage (99.6%) and was entirely unreachable.
  { name: "revenue",     prefix: "/api/v1/revenue",  upstream: upstream("revenue", 3038) },
  { name: "metadata",    prefix: "/api/v1/metadata", upstream: upstream("metadata", 3039) },
  // Customer-engagement platform services (generic — client-specific behaviour
  // lives in services/adapters/*). These were built and tested but had NO
  // gateway route, so every request 404'd and no client could reach them.
  // Ports: recommendation 3040, ai-agent 3041, journey 3045, field 3046,
  // cdp 3047, loyalty 3048 (catalogue 3044). Keep ecosystem.config.js in sync.
  { name: "cdp",             prefix: "/api/v1/cdp",             upstream: upstream("cdp", 3047) },
  { name: "catalogue",       prefix: "/api/v1/catalogue",       upstream: upstream("catalogue", 3044) },
  { name: "journeys",        prefix: "/api/v1/journeys",        upstream: upstream("journey", 3045) },
  { name: "field",           prefix: "/api/v1/field",           upstream: upstream("field", 3046) },
  { name: "recommendations", prefix: "/api/v1/recommendations", upstream: upstream("recommendation", 3040) },
  { name: "ai",              prefix: "/api/v1/ai",              upstream: upstream("ai-agent", 3041) },
  { name: "loyalty",         prefix: "/api/v1/loyalty",         upstream: upstream("loyalty", 3048) },
  { name: "locations",      prefix: "/api/v1/locations",     upstream: upstream("location", 4012) },
  { name: "geofences",     prefix: "/api/v1/geofences",    upstream: upstream("location", 4012) },
  { name: "jurisdictions", prefix: "/api/v1/jurisdictions", upstream: upstream("location", 4012) },
  { name: "hierarchy",     prefix: "/api/v1/hierarchy",    upstream: upstream("location", 4012) },
  { name: "pincodes",      prefix: "/api/v1/pincodes",     upstream: upstream("location", 4012) },
  { name: "tenant",       prefix: "/api/v1/tenants",   upstream: upstream("tenant", 3002) },
  { name: "tenant-singular", prefix: "/api/v1/tenant", upstream: upstream("tenant", 3002) },
  { name: "sync",         prefix: "/api/v1/sync",      upstream: upstream("identity", 3001), upstreamPath: "/v1/sync" },
  { name: "devices",      prefix: "/api/v1/devices",   upstream: upstream("identity", 3001), upstreamPath: "/v1/devices" },
  { name: "queue",        prefix: "/api/v1/queue",     upstream: upstream("queue", 3030), upstreamPath: "/v1/queue" },
];

export function resolveRoute(pathname: string): { route: ServiceRoute; remainder: string } | null {
  const sorted = [...SERVICE_ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const route of sorted) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      const remainder = pathname.slice(route.prefix.length) || "/";
      return { route, remainder };
    }
  }
  return null;
}

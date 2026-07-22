/**
 * Consumer-driven contract smoke — verifies gateway routes resolve.
 */
import { describe, it, expect } from "vitest";
import { SERVICE_ROUTES } from "../../services/gateway-service/src/registry.js";

/** Web loader paths that must resolve through the gateway without 404. */
const LOADER_PATHS = [
  { method: "GET", gatewayPath: "/api/audit/events", expectUpstream: "/audit/events" },
  { method: "GET", gatewayPath: "/api/identity/users", expectUpstream: "/identity/users" },
  { method: "GET", gatewayPath: "/api/policy/roles", expectUpstream: "/policy/roles" },
  { method: "GET", gatewayPath: "/api/v1/admin/tenant/modules", expectUpstream: "/v1/admin/tenant/modules" },
  { method: "GET", gatewayPath: "/api/v1/citizen/tickets", expectUpstream: "/v1/citizen/tickets" },
  { method: "GET", gatewayPath: "/api/v1/citizen/analytics/metrics", expectUpstream: "/v1/citizen/analytics/metrics" },
  { method: "GET", gatewayPath: "/api/v1/citizen/analytics/sla-rules", expectUpstream: "/v1/citizen/analytics/sla-rules" },
  { method: "GET", gatewayPath: "/api/v1/helpdesk/tickets", expectUpstream: "/v1/helpdesk/tickets" },
  { method: "GET", gatewayPath: "/api/v1/crm/contacts", expectUpstream: "/v1/crm/contacts" },
  { method: "GET", gatewayPath: "/api/v1/crm/deals", expectUpstream: "/v1/crm/deals" },
  { method: "GET", gatewayPath: "/api/v1/crm/activities", expectUpstream: "/v1/crm/activities" },
  { method: "GET", gatewayPath: "/api/v1/finance/payments", expectUpstream: "/v1/finance/payments" },
  { method: "GET", gatewayPath: "/api/v1/finance/accounts", expectUpstream: "/v1/finance/accounts" },
  { method: "GET", gatewayPath: "/api/v1/hrms/employees", expectUpstream: "/v1/hrms/employees" },
  { method: "GET", gatewayPath: "/api/v1/hrms/leave-applications", expectUpstream: "/v1/hrms/leave-applications" },
  { method: "GET", gatewayPath: "/api/v1/hrms/attendance/summary", expectUpstream: "/v1/hrms/attendance/summary" },
  { method: "GET", gatewayPath: "/api/v1/payroll/runs", expectUpstream: "/v1/payroll/runs" },
  { method: "GET", gatewayPath: "/api/v1/procurement/vendors", expectUpstream: "/v1/procurement/vendors" },
  { method: "GET", gatewayPath: "/api/v1/procurement/pos", expectUpstream: "/v1/procurement/pos" },
  { method: "GET", gatewayPath: "/api/v1/procurement/approvals", expectUpstream: "/v1/procurement/approvals" },
  { method: "GET", gatewayPath: "/api/v1/install/stages", expectUpstream: "/v1/install/stages" },
  { method: "GET", gatewayPath: "/api/v1/plugins/items", expectUpstream: "/v1/plugins/items" },
  { method: "GET", gatewayPath: "/api/v1/themes/tokens", expectUpstream: "/v1/themes/tokens" },
  { method: "GET", gatewayPath: "/api/v1/project/projects", expectUpstream: "/v1/projects/projects" },
  { method: "GET", gatewayPath: "/api/v1/asset/assets", expectUpstream: "/v1/assets/assets" },
  { method: "GET", gatewayPath: "/api/notification/templates", expectUpstream: "/notifications/templates" },
  { method: "GET", gatewayPath: "/api/notification/deliveries", expectUpstream: "/notifications/deliveries" },
  { method: "GET", gatewayPath: "/api/v1/legal/cases", expectUpstream: "/v1/legal/cases" },
  { method: "GET", gatewayPath: "/api/v1/stock/items", expectUpstream: "/v1/stock/items" },
  { method: "GET", gatewayPath: "/api/v1/billing/plans", expectUpstream: "/v1/billing/plans" },
  { method: "GET", gatewayPath: "/api/v1/contract/contracts", expectUpstream: "/v1/contract/contracts" },
  { method: "GET", gatewayPath: "/api/v1/inventory/items", expectUpstream: "/v1/inventory/items" },
  { method: "GET", gatewayPath: "/api/v1/telephony/calls", expectUpstream: "/v1/telephony/calls" },
  { method: "GET", gatewayPath: "/api/v1/locations", expectUpstream: "/v1/locations/" },
  { method: "GET", gatewayPath: "/api/v1/reports/jobs", expectUpstream: "/v1/reports/jobs" },
  { method: "GET", gatewayPath: "/api/v1/grants/schemes", expectUpstream: "/v1/grants/schemes" },
  { method: "GET", gatewayPath: "/api/v1/grants/installments", expectUpstream: "/v1/grants/installments" },
  { method: "GET", gatewayPath: "/api/v1/estab/files", expectUpstream: "/v1/estab/files" },
  { method: "GET", gatewayPath: "/api/v1/admin/health", expectUpstream: "/v1/admin/health" },
  { method: "GET", gatewayPath: "/api/v1/admin/health/readiness", expectUpstream: "/v1/admin/health/readiness" },
  { method: "GET", gatewayPath: "/api/v1/admin/operations", expectUpstream: "/v1/admin/operations" },
  { method: "GET", gatewayPath: "/api/v1/knowledge/documents", expectUpstream: "/v1/knowledge/documents" },
  { method: "GET", gatewayPath: "/api/v1/workflow/instances", expectUpstream: "/v1/workflow/instances" },
  { method: "GET", gatewayPath: "/api/v1/analytics/dashboards", expectUpstream: "/v1/analytics/dashboards" },
] as const;

function resolveUpstream(gatewayPath: string): string | null {
  const pathname = gatewayPath.split("?")[0] ?? gatewayPath;
  const sorted = [...SERVICE_ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const route of sorted) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      const remainder = pathname.slice(route.prefix.length) || "/";
      const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
      return `${basePath}${remainder}`;
    }
  }
  return null;
}

describe("gateway contract", () => {
  it("registers all domain modules", () => {
    const names = SERVICE_ROUTES.map((r) => r.name);
    for (const mod of [
      "finance", "citizen", "crm", "hrms", "procurement", "payroll", "identity", "policy", "audit",
      "theme", "plugin", "install", "reports", "inventory", "telephony", "helpdesk", "locations", "queue",
      "project", "asset", "notification", "knowledge", "workflow", "analytics",
    ]) {
      expect(names).toContain(mod);
    }
  });

  it("allows only intentional upstream aliases", () => {
    // Each set lists the route names that intentionally share a single upstream
    // service. Any upstream serving more than one route MUST be fully contained
    // in exactly one of these families — this catches accidental drift (a route
    // pointed at the wrong upstream) while permitting the documented aliases.
    const ALIAS_FAMILIES: readonly string[][] = [
      // identity-service hosts auth, admin user mgmt, mobile sync + device APIs
      ["identity", "admin-users", "sync", "devices"],
      // audit-service: legacy /api/audit + versioned /api/v1/audit
      ["audit", "audit-events"],
      // policy-service: unversioned + /v1 alias
      ["policy", "policy-v1"],
      // estab-service: short + long spelling
      ["estab", "establishment"],
      // hrms-service: canonical /hrms + /hr convenience alias + /careers (recruitment)
      ["hrms", "hr", "careers"],
      // project-service: singular gateway prefix + plural upstream
      ["project", "projects"],
      // asset-service: singular gateway prefix + plural upstream
      ["asset", "assets"],
      // grant-service: plural /grants + singular /grant alias
      ["grant", "grant-alias"],
      // court-service: singular /court + plural /courts alias
      ["court", "courts"],
    ];

    const byUpstream = new Map<string, string[]>();
    for (const route of SERVICE_ROUTES) {
      const names = byUpstream.get(route.upstream) ?? [];
      names.push(route.name);
      byUpstream.set(route.upstream, names);
    }
    for (const names of byUpstream.values()) {
      if (names.length <= 1) continue;
      const matchesOneFamily = ALIAS_FAMILIES.some((family) =>
        names.every((n) => family.includes(n)),
      );
      expect(matchesOneFamily, `unexpected upstream alias group: ${names.join(", ")}`).toBe(true);
    }
  });

  it("maps web loader paths to correct upstream URLs", () => {
    for (const { gatewayPath, expectUpstream } of LOADER_PATHS) {
      expect(resolveUpstream(gatewayPath)).toBe(expectUpstream);
    }
  });

  it("fixes singular gateway prefixes for plural upstream routes", () => {
    expect(resolveUpstream("/api/v1/project/projects")).toBe("/v1/projects/projects");
    expect(resolveUpstream("/api/v1/asset/assets")).toBe("/v1/assets/assets");
    expect(resolveUpstream("/api/notification/templates")).toBe("/notifications/templates");
  });
});

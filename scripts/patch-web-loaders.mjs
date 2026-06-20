#!/usr/bin/env node
/** Remove mock fallbacks from web loaders — use empty defaults. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = join(new URL("..", import.meta.url).pathname, "apps/web/src/app/_data/loaders.ts");
let s = readFileSync(file, "utf8");

// Drop mockData import block
s = s.replace(/import \{[\s\S]*?\} from "\.\/mockData";\n/, "");

// fetchJsonWithFallback -> fetchJson with empty defaults
const replacements = [
  ["payments,", "[] as PaymentSummary[],"],
  ["auditItems,", "[] as AuditRowSummary[],"],
  ["helpdeskMetrics,", "[] as MetricCard[],"],
  ["slaRules,", "[] as SLAQueueSummary[],"],
  ["helpdeskTickets,", "[] as HelpdeskTicketSummary[],"],
  ["chartOfAccounts,", "[] as AccountSummary[],"],
  ["tenantUsers,", "[] as TenantUserSummary[],"],
  ["tenantRoles,", "[] as RoleAssignmentSummary[],"],
  ["tenantSettings,", "[] as TenantSettingSummary[],"],
  ["employees,", "[] as EmployeeSummary[],"],
  ["leaveRequests,", "[] as LeaveRequestSummary[],"],
  ["attendanceSummaries,", "[] as AttendanceSummary[],"],
  ["payrollRuns,", "[] as PayrollRunSummary[],"],
  ["vendors,", "[] as VendorSummary[],"],
  ["purchaseOrders,", "[] as PurchaseOrderSummary[],"],
  ["procurementApprovals,", "[] as ApprovalSummary[],"],
];

s = s.replace(/fetchJsonWithFallback/g, "fetchJson");
for (const [from, to] of replacements) {
  s = s.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), to);
}

// Mock-only loaders -> API paths (stub services)
s = s.replace(
  /export async function getPlugins\(\): Promise<LoaderResult<PluginSummary\[\]>> \{\s*return staticLoaderResult\(plugins\);\s*\}/,
  `export async function getPlugins(): Promise<LoaderResult<PluginSummary[]>> {
  return fetchJson("/api/v1/plugins", [] as PluginSummary[], {
    telemetryKey: "plugins",
    mapResponse: (p) => getArrayPayload(p) as PluginSummary[] | null,
  });
}`,
);

s = s.replace(
  /export async function getThemeTokens\(\): Promise<LoaderResult<ThemeTokenSummary\[\]>> \{\s*return staticLoaderResult\(themeTokens\);\s*\}/,
  `export async function getThemeTokens(): Promise<LoaderResult<ThemeTokenSummary[]>> {
  return fetchJson("/api/v1/themes/tokens", [] as ThemeTokenSummary[], {
    telemetryKey: "themes",
    mapResponse: (p) => getArrayPayload(p) as ThemeTokenSummary[] | null,
  });
}`,
);

s = s.replace(
  /export async function getInstallerStages\(\): Promise<LoaderResult<InstallerStageSummary\[\]>> \{\s*return staticLoaderResult\(installerStages\);\s*\}/,
  `export async function getInstallerStages(): Promise<LoaderResult<InstallerStageSummary[]>> {
  return fetchJson("/api/v1/install/stages", [] as InstallerStageSummary[], {
    telemetryKey: "install",
    mapResponse: (p) => getArrayPayload(p) as InstallerStageSummary[] | null,
  });
}`,
);

writeFileSync(file, s);
console.log("loaders.ts patched — mock fallbacks removed");

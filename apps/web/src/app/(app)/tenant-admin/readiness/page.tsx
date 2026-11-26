import Link from "next/link";
import { PageHeader, StatCard, StatGrid, Card, ProgressBar, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getTenantAdminDashboard, type ReadinessGate } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";

// B28 (TENANT-ADMIN-READINESS-03): the gates below (queue-first writes, workers, k6, contract tests,
// DB indexes, ...) are PLATFORM-ENGINEERING checks. Only platform_admin / super_admin see them; a tenant
// admin gets TENANT_CHECKLIST instead, which lists only things a tenant can configure itself.
const PLATFORM_READINESS_ROLES = ["platform_admin", "super_admin"] as const;

// Tenant-fixable go-live steps. Each target is an existing /tenant-admin screen. There is no per-tenant
// completion endpoint, so the rows are links to do the work, never fabricated Pass/Fail states.
const TENANT_CHECKLIST: ReadonlyArray<{ key: string; label: string; description: string; href: string }> = [
  { key: "orgHierarchy", label: "Set up your organisation structure", description: "Create departments, wings and units so staff and approvals map to your office.", href: "/tenant-admin/org-hierarchy" },
  { key: "users", label: "Add your staff", description: "Create user accounts or invite officers to the platform.", href: "/tenant-admin/users" },
  { key: "roles", label: "Assign roles", description: "Give each user only the roles their work needs.", href: "/tenant-admin/roles" },
  { key: "mfa", label: "Review multi-factor sign-in", description: "Confirm your multi-factor authentication policy for staff accounts.", href: "/tenant-admin/mfa" },
  { key: "sso", label: "Connect single sign-on (optional)", description: "Link your identity provider if your office uses one.", href: "/tenant-admin/sso" },
  { key: "domain", label: "Confirm your domain", description: "Check the domain your office signs in from.", href: "/tenant-admin/domain" },
  { key: "notifications", label: "Configure notifications", description: "Choose how staff and citizens are notified.", href: "/tenant-admin/notifications" },
  { key: "settings", label: "Review tenant settings", description: "Check the organisation profile and module settings.", href: "/tenant-admin/settings" },
];

function TenantReadiness() {
  return (
    <div className="page-main wrap">
      <PageHeader
        title="Go-live Checklist"
        subtitle="Steps your office can complete itself before go-live. Platform-level checks are handled by the platform team."
      />
      <Card title="Your setup checklist" padding>
        <ul aria-label="Tenant setup items" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {TENANT_CHECKLIST.map((item) => (
            <li key={item.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{item.label}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>{item.description}</p>
              </div>
              <Link href={item.href} className="lnk" style={{ fontSize: 13 }}>Open →</Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// GAP-TENANT-ADMIN-READINESS-01 / -03: display metadata for the live gate keys
// returned by admin-service's /v1/admin/health/readiness. Each gate maps to a
// human label, a one-line description, and (where one exists) the screen that
// an operator uses to fix it. Unknown keys fall back to a humanised key with no
// fix link, so a new backend gate never crashes the page or 404s a link.
const GATE_META: Record<string, { label: string; description: string; href?: string }> = {
  queueFirstWrites: { label: "Queue-first writes", description: "All write paths publish commands to the queue (CQRS)." },
  responseValidation: { label: "Response validation", description: "Every endpoint validates its response payload with zod." },
  workersRunning: { label: "Workers running", description: "Background consumers are running for every service." },
  opsOnAllServices: { label: "Operations wired", description: "Every service exposes health, metrics and ops endpoints." },
  noMockWeb: { label: "No mock web data", description: "The web app reads live service APIs, not fixtures." },
  k6Present: { label: "Load tests present", description: "k6 performance tests exist for critical paths." },
  contractPresent: { label: "Contract tests present", description: "Consumer-driven contract tests are in place." },
  perfIndexes: { label: "Performance indexes", description: "Required database indexes are applied." },
  openapiViaOps: { label: "OpenAPI published", description: "API specs are served via the operations endpoint." },
};

function humaniseKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export default async function ReadinessPage() {
  const isPlatform = getSessionRoles().some((r) => (PLATFORM_READINESS_ROLES as readonly string[]).includes(r));
  // A tenant admin never fetches or sees the platform-engineering gate map.
  if (!isPlatform) return <TenantReadiness />;
  const result = await getTenantAdminDashboard();
  const { data: dashboard, source } = result;
  const errored = toResourceState(result).status === "error";
  const readiness = dashboard.readiness;

  // GAP-TENANT-ADMIN-READINESS-01: the checklist is now derived from the live
  // backend gate map, not a hard-coded constant. If the backend returns no
  // per-gate data, `gates` is empty and we show an honest not-available state.
  const gates: ReadinessGate[] = readiness?.gates ?? [];
  const total = gates.length;
  // GAP-TENANT-ADMIN-READINESS-02: all counts come from the SAME array in one
  // pass, so passed + failed can never disagree with the rows or exceed total.
  const passed = gates.filter((g) => g.passed).length;
  const failed = total - passed;
  const overallPct = readiness ? readiness.overall : 0;
  const hasReadiness = readiness !== null;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Tenant Readiness Score"
        subtitle="Overall readiness assessment — track configuration progress and go-live checklist completion."
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🎯" tone="info" label="Overall Readiness" value={errored || !hasReadiness ? "—" : `${overallPct}%`} />
        <StatCard icon="✅" tone="good" label="Passed" value={errored || !hasReadiness ? "—" : `${passed} of ${total}`} />
        <StatCard icon="❌" tone="bad" label="Failed" value={errored || !hasReadiness ? "—" : failed} />
        <StatCard icon="🚀" tone="warn" label="Go-live" value={errored || !hasReadiness ? "—" : readiness!.productionReady ? "Ready" : "Not ready"} />
      </StatGrid>

      {errored ? (
        <Card title="Readiness Progress" padding>
          <RefreshErrorState error={toHumanError("load", { area: "readiness score" })} backHref="/tenant-admin" />
        </Card>
      ) : !hasReadiness ? (
        <Card title="Readiness Progress" padding>
          <EmptyState icon="🎯" title="Readiness score not available" message="Detailed go-live checks are not available for this tenant yet." />
        </Card>
      ) : (
        <>
          {/* GAP-TENANT-ADMIN-READINESS-04: state go-live status in text, not colour alone. */}
          <Card title="Go-live status" padding>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StatusPill
                status={readiness!.productionReady ? "active" : "in progress"}
                label={readiness!.productionReady ? "Ready for go-live" : "Not ready for go-live"}
              />
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                {readiness!.allGreen ? "All gates passing." : `${failed} gate${failed === 1 ? "" : "s"} still need attention.`}
              </span>
            </div>
          </Card>

          <Card title="Readiness Progress" padding>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
                <span>Overall completion</span>
                <span>{overallPct}%</span>
              </div>
              {/* GAP-TENANT-ADMIN-READINESS-05: labelled, screen-reader announceable. */}
              <ProgressBar value={overallPct} color="var(--good)" label="Overall completion" />
            </div>
          </Card>

          <Card title="Readiness Checklist" padding>
            {total === 0 ? (
              <EmptyState icon="🎯" title="No readiness checks available" message="Detailed checks will appear here once the platform reports gate results." />
            ) : (
              <ul aria-label="Readiness items" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {gates.map((gate) => {
                  const meta = GATE_META[gate.key] ?? { label: humaniseKey(gate.key), description: "" };
                  return (
                    <li key={gate.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{meta.label}</p>
                        {meta.description && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>{meta.description}</p>}
                      </div>
                      {/* GAP-TENANT-ADMIN-READINESS-03: non-pass rows get a Fix link to the right screen (only when a target exists). */}
                      {!gate.passed && meta.href && (
                        <Link href={meta.href} className="lnk" style={{ fontSize: 13 }}>Fix →</Link>
                      )}
                      <StatusPill status={gate.passed ? "active" : "failed"} label={gate.passed ? "Pass" : "Fail"} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAGateways } from "@/app/_data/loaders";
import { GatewaysTable } from "./GatewaysTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function GatewaysPage() {
  // GAP-ADMIN-GATEWAYS-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Communication Gateways" area="communication gateways" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: gateways, source } = await getSAGateways();
  const active = gateways.filter((g) => String(g.status).toLowerCase() === "active").length;
  const degraded = gateways.filter((g) => String(g.status).toLowerCase() === "degraded").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside GatewaysTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Communication Gateways"
        subtitle="SMS, email, WhatsApp and push notification gateway status."
        back="/admin"
      />
      <p className="back" style={{ marginTop: 8 }}>
        <a href="/admin/gateway-config">Edge config</a>
        {" · "}
        <a href="/admin/gateway-routes">API route catalogue</a>
      </p>
      <StatGrid>
        <StatCard icon="📡" iconBg="#eef2ff" label="Total Gateways" value={gateways.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={degraded} />
        <StatCard icon="📨" iconBg="#fce7ee" label="Standby" value={gateways.length - active - degraded} />
      </StatGrid>
      <Card title="Gateway Status">
        <GatewaysTable gateways={gateways} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}

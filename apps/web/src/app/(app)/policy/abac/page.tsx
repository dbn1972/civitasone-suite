import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { getAbacRules } from "../_data";

export const dynamic = "force-dynamic";

export default async function PolicyAbacPage() {
  const { data: rules, source } = await getAbacRules();
  const enabled = rules.filter((r) => r.enabled).length;
  const deny = rules.filter((r) => r.expression?.effect === "deny").length;

  return (
    <main className="page-main wrap" aria-label="ABAC rules">
      <PageHeader
        title="ABAC Rules"
        subtitle="Attribute-based access rules loaded from /api/v1/policy/abac/rules."
        back="/policy"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#eff8ff" label="Rules" value={rules.length} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Enabled" value={enabled} />
        <StatCard icon="🚫" iconBg="#fee2e2" label="Deny effect" value={deny} />
      </StatGrid>

      <Card title="Rules">
        {rules.length === 0 ? (
          <EmptyState
            icon="🛡️"
            title="No ABAC rules"
            message="Attribute-based rules for this tenant will appear here once published."
          />
        ) : (
          <div className="table-wrap" role="region" aria-label="ABAC rules table">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Effect</th>
                  <th scope="col">Role</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Id</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.expression?.action ?? "—"}</td>
                    <td>{r.expression?.resourceType ?? "—"}</td>
                    <td><StatusPill status={r.expression?.effect ?? "unknown"} /></td>
                    <td><code>{r.roleId}</code></td>
                    <td><StatusPill status={r.enabled ? "active" : "inactive"} /></td>
                    <td><code>{r.id}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}

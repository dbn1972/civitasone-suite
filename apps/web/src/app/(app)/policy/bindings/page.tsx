import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { getPolicyBindings } from "../_data";
import { BindingCreateForm } from "./BindingCreateForm";

export const dynamic = "force-dynamic";

export default async function PolicyBindingsPage() {
  const { data: bindings, source } = await getPolicyBindings();
  const active = bindings.filter((b) => b.status === "active").length;
  const revoked = bindings.filter((b) => b.status === "revoked").length;

  return (
    <main className="page-main wrap" aria-label="Policy bindings">
      <PageHeader
        title="Role Bindings"
        subtitle="Assign roles to users. Reads and creates go through /api/v1/policy/bindings."
        back="/policy"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff8ff" label="Total" value={bindings.length} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fee2e2" label="Revoked" value={revoked} />
      </StatGrid>

      <Card title="Create binding" padding>
        <BindingCreateForm />
      </Card>

      <Card title="Bindings">
        {bindings.length === 0 ? (
          <EmptyState
            icon="🔗"
            title="No bindings found"
            message="User–role bindings will appear here once assigned for this tenant."
          />
        ) : (
          <div className="table-wrap" role="region" aria-label="Bindings table">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Id</th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((b) => (
                  <tr key={b.id}>
                    <td><code>{b.userId}</code></td>
                    <td><code>{b.roleId}</code></td>
                    <td><StatusPill status={b.status} /></td>
                    <td><code>{b.id}</code></td>
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

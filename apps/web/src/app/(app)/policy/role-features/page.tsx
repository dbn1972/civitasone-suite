import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { getRoleFeatureGrants } from "../_data";
import { RoleFeatureGrantForm } from "./RoleFeatureGrantForm";

export const dynamic = "force-dynamic";

export default async function PolicyRoleFeaturesPage() {
  const { data: grants, source } = await getRoleFeatureGrants();
  const granted = grants.filter((g) => g.granted).length;
  const roles = new Set(grants.map((g) => g.roleName)).size;

  return (
    <main className="page-main wrap" aria-label="Role feature grants">
      <PageHeader
        title="Role Features"
        subtitle="Feature visibility grants loaded from /api/v1/policy/role-features."
        back="/policy"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🎛️" iconBg="#eff8ff" label="Grants" value={grants.length} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Granted" value={granted} />
        <StatCard icon="👤" iconBg="#faf5ff" label="Roles" value={roles} />
      </StatGrid>

      <Card title="Grant a feature" padding>
        <RoleFeatureGrantForm />
      </Card>

      <Card title="Grants">
        {grants.length === 0 ? (
          <EmptyState
            icon="🎛️"
            title="No role-feature grants"
            message="Grants controlling which features each role can see will appear here."
          />
        ) : (
          <div className="table-wrap" role="region" aria-label="Role feature grants table">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Feature</th>
                  <th scope="col">Granted</th>
                  <th scope="col">Id</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td>{g.roleName}</td>
                    <td><code>{g.featureKey}</code></td>
                    <td>
                      <StatusPill status={g.granted ? "active" : "inactive"} label={g.granted ? "granted" : "revoked"} />
                    </td>
                    <td><code>{g.id}</code></td>
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

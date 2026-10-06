import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { getRoleFeatureGrants } from "../_data";
import { toHumanError } from "@/lib/messages";
import { RoleFeatureGrantForm } from "./RoleFeatureGrantForm";
import { GrantRowActions } from "./GrantRowActions";

export const dynamic = "force-dynamic";

export default async function PolicyRoleFeaturesPage() {
  const { data: grants, source } = await getRoleFeatureGrants();
  const errored = source === "error";
  const granted = errored ? 0 : grants.filter((g) => g.granted).length;
  const roles = errored ? 0 : new Set(grants.map((g) => g.roleName)).size;

  return (
    <div className="page-main wrap" aria-label="Role feature grants">
      <PageHeader
        title="Role Features"
        subtitle="Control which features each role can see. Granting is confirmed and audited."
        back="/policy"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🎛️" iconBg="#eff8ff" label="Grants" value={errored ? "—" : grants.length} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Granted" value={errored ? "—" : granted} />
        {/* GAP-POLICY-ROLE-FEATURES-05: label matches what is counted. */}
        <StatCard icon="👤" iconBg="#faf5ff" label="Roles with grants" value={errored ? "—" : roles} />
      </StatGrid>

      <Card title="Grant a feature" padding>
        <RoleFeatureGrantForm />
      </Card>

      <Card title="Grants">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "role-feature grants" })} backHref="/policy" />
        ) : grants.length === 0 ? (
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
                  {/* GAP-POLICY-ROLE-FEATURES-05: one vocabulary — Granted/Revoked. */}
                  <th scope="col">Granted</th>
                  <th scope="col">Id</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td>{g.roleName}</td>
                    <td><code>{g.featureKey}</code></td>
                    <td>
                      <StatusPill
                        status={g.granted ? "granted" : "revoked"}
                        variant={g.granted ? "good" : "bad"}
                        label={g.granted ? "Granted" : "Revoked"}
                      />
                    </td>
                    <td><code>{g.id}</code></td>
                    <td>
                      <GrantRowActions
                        grantId={g.id}
                        roleName={g.roleName}
                        featureKey={g.featureKey}
                        granted={g.granted}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

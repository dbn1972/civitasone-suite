import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { getPolicyBindings } from "../_data";
import { getAdminRoles, getAdminUsers } from "@/app/_data/loaders";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { BindingCreateForm } from "./BindingCreateForm";
import { BindingRowActions } from "./BindingRowActions";

export const dynamic = "force-dynamic";

export default async function PolicyBindingsPage() {
  const [{ data: bindings, source }, { data: roles }, { data: users }] = await Promise.all([
    getPolicyBindings(),
    getAdminRoles(),
    getAdminUsers(),
  ]);
  const errored = source === "error";
  const active = errored ? 0 : bindings.filter((b) => b.status === "active").length;
  const revoked = errored ? 0 : bindings.filter((b) => b.status === "revoked").length;
  const currentUserId = getSessionUserId();
  // GAP-POLICY-BINDINGS-02: resolve ids to names for the list; keep the id as
  // secondary (title) text, falling back to a short id when unresolved.
  const roleNameById = new Map(roles.map((r) => [r.id, r.name] as const));
  const userNameById = new Map(users.map((u) => [u.id, u.name ?? u.email] as const));
  const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Role Bindings"
        subtitle="Assign roles to users. Each grant is confirmed with a reason and audited."
        back="/policy"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🔗" iconBg="#eff8ff" label="Total" value={errored ? "—" : bindings.length} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={errored ? "—" : active} />
        <StatCard icon="⛔" iconBg="#fee2e2" label="Revoked" value={errored ? "—" : revoked} />
      </StatGrid>

      <Card title="Create binding" padding>
        <BindingCreateForm currentUserId={currentUserId} />
      </Card>

      <Card title="Bindings">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "role bindings" })} backHref="/policy" />
        ) : bindings.length === 0 ? (
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
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((b) => {
                  const userName = userNameById.get(b.userId);
                  const roleName = roleNameById.get(b.roleId);
                  return (
                    <tr key={b.id}>
                      <td>{userName ? <span title={b.userId}>{userName}</span> : <code title={b.userId}>{shortId(b.userId)}</code>}</td>
                      <td>{roleName ? <span title={b.roleId}>{roleName}</span> : <code title={b.roleId}>{shortId(b.roleId)}</code>}</td>
                      <td><StatusPill status={b.status} /></td>
                      <td><code title={b.id}>{shortId(b.id)}</code></td>
                      <td>
                        <BindingRowActions
                          bindingId={b.id}
                          status={b.status}
                          label={`${roleName ?? shortId(b.roleId)} → ${userName ?? shortId(b.userId)}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

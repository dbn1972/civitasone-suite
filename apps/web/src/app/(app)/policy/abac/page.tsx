import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { getAbacRules, formatAbacPredicate } from "../_data";
import { getAdminRoles } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function PolicyAbacPage() {
  const [{ data: rules, source }, { data: roles }] = await Promise.all([getAbacRules(), getAdminRoles()]);
  const errored = source === "error";
  const enabled = errored ? 0 : rules.filter((r) => r.enabled).length;
  const deny = errored ? 0 : rules.filter((r) => r.expression?.effect === "deny").length;
  // GAP-POLICY-ABAC-03: resolve role UUIDs to human names (same source
  // /platform-admin/roles uses). Falls back to a short id when unresolved.
  const roleNameById = new Map(roles.map((r) => [r.id, r.name] as const));
  const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="ABAC Rules"
        subtitle="Attribute-based access rules that allow or deny actions on resources (read-only view)."
        back="/policy"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#eff8ff" label="Rules" value={errored ? "—" : rules.length} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Enabled" value={errored ? "—" : enabled} />
        <StatCard icon="🚫" iconBg="#fee2e2" label="Deny effect" value={errored ? "—" : deny} />
      </StatGrid>

      <Card title="Rules">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "ABAC rules" })} backHref="/policy" />
        ) : rules.length === 0 ? (
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
                  <th scope="col">Conditions</th>
                  <th scope="col">Role</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Id</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const predicates = r.expression?.predicates ?? [];
                  const roleName = roleNameById.get(r.roleId);
                  const effect = r.expression?.effect ?? "unknown";
                  return (
                    // GAP-POLICY-EVALUATE-02: a stable anchor so the Evaluate
                    // result can deep-link to the matched rule (#rule-<id>).
                    <tr key={r.id} id={`rule-${r.id}`}>
                      <td>{r.expression?.action ?? "—"}</td>
                      <td>{r.expression?.resourceType ?? "—"}</td>
                      <td><StatusPill status={effect} /></td>
                      <td>
                        {/* GAP-POLICY-ABAC-01: render each predicate so an admin
                            can see what a deny rule actually matches. */}
                        {predicates.length > 0 ? (
                          <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                            {predicates.map((p, i) => (
                              <li key={i}>
                                <code>{formatAbacPredicate(p)}</code>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span style={{ color: "var(--mut, #64748b)" }}>Applies to all</span>
                        )}
                      </td>
                      <td>
                        {roleName ? (
                          <span title={r.roleId}>{roleName}</span>
                        ) : (
                          <code title={r.roleId}>{shortId(r.roleId)}</code>
                        )}
                      </td>
                      <td><StatusPill status={r.enabled ? "active" : "inactive"} label={r.enabled ? "Enabled" : "Disabled"} /></td>
                      <td><code title={r.id}>{shortId(r.id)}</code></td>
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

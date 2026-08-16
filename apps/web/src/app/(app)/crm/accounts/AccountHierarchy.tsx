import type { CRMAccountSummary } from "@civitasone/types";
import { EmptyState } from "../../../_components/ds";
import { buildAccountTree } from "./hierarchy";

/**
 * Indented parent → child view of the account master. Built from the single
 * accounts list response, so opening this panel costs no extra API call.
 */
export function AccountHierarchy({ accounts }: { accounts: CRMAccountSummary[] }) {
  const rows = buildAccountTree(accounts);

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>Account Hierarchy</h3></div>
      {rows.length === 0 ? (
        <EmptyState icon="🌳" title="No hierarchy yet" message="Accounts appear here once the organisation master has entries." />
      ) : (
        <div className="pad">
          <ul role="tree" aria-label="Account hierarchy" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <li key={row.id} role="treeitem" aria-level={row.depth + 1} style={{ paddingLeft: row.depth * 20, marginBottom: 6 }}>
                <span aria-hidden="true" style={{ color: "var(--muted)", marginRight: 6 }}>
                  {row.depth > 0 ? "└" : "●"}
                </span>
                <a href={`/crm/accounts/${row.id}`}>{row.name}</a>
                {row.industry ? (
                  <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>{row.industry}</span>
                ) : null}
                <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                  {row.contactCount === 1 ? "1 contact" : `${row.contactCount} contacts`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

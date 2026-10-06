import type { CRMAccountSummary } from "@civitasone/types";
import { EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { useTranslations } from "next-intl";
import { buildNestedAccountTree, type AccountTreeNode } from "./hierarchy";

/**
 * Indented parent → child view of the account master. Built from the single
 * accounts list response, so opening this panel costs no extra API call.
 *
 * GAP-CRM-ACCOUNTS-06: this is ordinary navigation, not an interactive tree
 * widget. We render real nested <ul>/<li> (no role="tree"/"treeitem", no
 * aria-selected/aria-level, no fake roving focus) so screen readers announce
 * list nesting natively and Tab moves link-to-link.
 */
function AccountNode({ node }: { node: AccountTreeNode }) {
  return (
    <li style={{ marginBottom: 6 }}>
      <span aria-hidden="true" style={{ color: "var(--muted)", marginInlineEnd: 6 }}>
        {node.children.length > 0 ? "●" : "└"}
      </span>
      <a href={`/crm/accounts/${node.id}`}>{node.name}</a>
      {node.industry ? (
        <span style={{ color: "var(--muted)", fontSize: 12, marginInlineStart: 8 }}>{node.industry}</span>
      ) : null}
      <span style={{ color: "var(--muted)", fontSize: 12, marginInlineStart: 8 }}>
        {node.contactCount === 1 ? "1 contact" : `${node.contactCount} contacts`}
      </span>
      {node.children.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, paddingInlineStart: 20 }}>
          {node.children.map((child) => (
            <AccountNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AccountHierarchy({
  accounts,
  source = "api",
}: {
  accounts: CRMAccountSummary[];
  source?: "api" | "error";
}) {
  const t = useTranslations("crmAccountHierarchy");
  const roots = buildNestedAccountTree(accounts);

  // GAP-CRM-ACCOUNTS-01: on a failed load the accounts list is [], so the tree
  // is empty too. Do not render "No hierarchy yet" (a fact about an empty
  // master) for an outage — surface a retry instead so the panel's message
  // matches the one on the table above.
  if (source === "error" && accounts.length === 0) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>{t("heading")}</h3></div>
        <RefreshErrorState error={toHumanError("load", { area: t("loadArea") })} backHref="/crm" />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h"><h3>{t("heading")}</h3></div>
      {roots.length === 0 ? (
        <EmptyState icon="🌳" title="No hierarchy yet" message="Accounts appear here once the organisation master has entries." />
      ) : (
        <div className="pad">
          <nav aria-label="Account hierarchy">
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {roots.map((node) => (
                <AccountNode key={node.id} node={node} />
              ))}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}

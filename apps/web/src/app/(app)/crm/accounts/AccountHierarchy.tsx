import type { CRMAccountSummary } from "@civitasone/types";
import { EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { useTranslations } from "next-intl";
import { buildAccountTree } from "./hierarchy";

/**
 * Indented parent → child view of the account master. Built from the single
 * accounts list response, so opening this panel costs no extra API call.
 */
export function AccountHierarchy({
  accounts,
  source = "api",
}: {
  accounts: CRMAccountSummary[];
  source?: "api" | "error";
}) {
  const t = useTranslations("crmAccountHierarchy");
  const rows = buildAccountTree(accounts);

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
      {rows.length === 0 ? (
        <EmptyState icon="🌳" title="No hierarchy yet" message="Accounts appear here once the organisation master has entries." />
      ) : (
        <div className="pad">
          <ul role="tree" aria-label="Account hierarchy" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <li key={row.id} role="treeitem" aria-selected={false} aria-level={row.depth + 1} style={{ paddingLeft: row.depth * 20, marginBottom: 6 }}>
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

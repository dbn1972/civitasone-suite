"use client";

import type { CRMAccountSummary } from "@civitasone/types";
import { DataTable, EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { useTranslations } from "next-intl";
import { useSeededResource } from "@/lib/sync/resource";

type AccountRow = {
  id: string;
  name: string;
  industry: string;
  website: string;
  hierarchy: string;
  contacts: number;
};

export function AccountsTable({
  accounts,
  source = "api",
}: {
  accounts: CRMAccountSummary[];
  source?: "api" | "error";
}) {
  const t = useTranslations("crmAccountsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CRMAccountSummary[]>(
    "crm.accounts",
    accounts,
    source,
    (d) => d.length === 0,
  );

  const nameById = new Map(rows.map((a) => [a.id, a.name]));

  const tableRows: AccountRow[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    industry: a.industry ?? "—",
    website: a.website ?? "—",
    hierarchy: a.parentId ? `Reports to ${nameById.get(a.parentId) ?? "another account"}` : "Top level",
    contacts: a.contactCount,
  }));

  const resolvedProvenance = provenance ?? "live";

  // GAP-CRM-ACCOUNTS-01: an outage (error-no-data: the load failed and there
  // is no cached copy) must not read as an empty master. Show a real retry,
  // not "No accounts yet — Create an account…". The DataSourceBadge is kept
  // only for the "cached" case (serving a saved copy) so there is never a
  // badge + error-state double message.
  if (resolvedProvenance === "error-no-data") {
    return (
      <div className="card">
        <div className="card-h"><h3>{t("heading")}</h3></div>
        <RefreshErrorState error={toHumanError("load", { area: t("loadArea") })} backHref="/crm" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h"><h3>{t("heading")}</h3></div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). The error-no-data
          outage case is handled above with a retry, so the badge now only
          ever reports "live" or "cached". */}
      <DataSourceBadge provenance={resolvedProvenance} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState
          icon="▣"
          title="No accounts yet"
          message="Create an account to group contacts and the reporting hierarchy for an organisation."
        />
      ) : (
        <DataTable<AccountRow>
          columns={[
            { key: "name", label: "Account" },
            { key: "industry", label: "Sector / Ministry" },
            { key: "website", label: "Website" },
            { key: "hierarchy", label: "Hierarchy" },
            { key: "contacts", label: "Contacts", align: "right" },
          ]}
          rows={tableRows}
          rowHref={(row) => `/crm/accounts/${row.id}`}
          sortable
          filterable
          filterPlaceholder="Filter accounts…"
          pageSize={25}
        />
      )}
    </div>
  );
}

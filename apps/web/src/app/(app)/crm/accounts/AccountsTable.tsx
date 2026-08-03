"use client";

import type { CRMAccountSummary } from "@civitasone/types";
import { DataTable, EmptyState } from "../../../_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CRMAccountSummary[]>(
    "crm.accounts",
    accounts,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const nameById = new Map(rows.map((a) => [a.id, a.name]));

  const tableRows: AccountRow[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    industry: a.industry ?? "—",
    website: a.website ?? "—",
    hierarchy: a.parentId ? `Reports to ${nameById.get(a.parentId) ?? "another account"}` : "Top level",
    contacts: a.contactCount,
  }));

  return (
    <div className="card">
      <div className="card-h"><h3>Accounts</h3></div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", paddingLeft: 12 }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No accounts yet"
          message="Create an account to group contacts, deals and the reporting hierarchy for an organisation."
        />
      ) : (
        <DataTable<AccountRow>
          columns={[
            { key: "name", label: "Account" },
            { key: "industry", label: "Industry" },
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

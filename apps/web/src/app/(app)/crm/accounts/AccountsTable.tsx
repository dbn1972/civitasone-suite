"use client";

import type { CRMAccountSummary } from "@civitasone/types";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { useSeededResource } from "@/lib/sync/resource";
import { getAgents } from "@/lib/crm/assignment";

type AccountRow = {
  id: string;
  name: string;
  industry: string;
  website: string;
  parentId: string | null;
  parentName: string | null;
  contacts: number;
  ownerId: string | null;
  ownerName: string;
};

export function AccountsTable({
  accounts,
  source = "api",
}: {
  accounts: CRMAccountSummary[];
  source?: "api" | "error";
}) {
  const t = useTranslations("crmAccountsTable");
  const tOwner = useTranslations("crmOwner");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CRMAccountSummary[]>(
    "crm.accounts",
    accounts,
    source,
    (d) => d.length === 0,
  );

  const nameById = new Map(rows.map((a) => [a.id, a.name]));

  // F5-01: resolve each account owner's id to a display NAME via the CRM agent
  // directory (never show a raw UUID in the Owner column). The directory is
  // small and shared with the assignment screens; a failed load leaves the
  // map empty and the column falls back to "Unassigned"/"—" rather than a UUID.
  const [ownerNames, setOwnerNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const ownerIds = Array.from(
      new Set(rows.map((a) => a.ownerId).filter((v): v is string => typeof v === "string" && v.length > 0)),
    );
    if (ownerIds.length === 0) {
      setOwnerNames(new Map());
      return;
    }
    void getAgents().then(({ data }) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const a of data) map.set(a.agentId, a.name);
      setOwnerNames(map);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const tableRows: AccountRow[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    industry: a.industry ?? "—",
    website: a.website ?? "—",
    parentId: a.parentId ?? null,
    parentName: a.parentId ? nameById.get(a.parentId) ?? null : null,
    contacts: a.contactCount,
    ownerId: a.ownerId ?? null,
    // Resolve the owner id to a name; a known id that the directory could not
    // (yet) resolve shows a short id fragment, never the full UUID.
    ownerName: a.ownerId
      ? ownerNames.get(a.ownerId) ?? tOwner("unknownUser")
      : tOwner("unassigned"),
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
            {
              key: "parentId",
              label: "Hierarchy",
              // GAP-CRM-ACCOUNTS-08: when the parent is not among the loaded
              // rows (a capped/cached page), say so explicitly and link to the
              // parent's own route instead of the opaque "another account".
              // stopPropagation so the nested link does not also trigger the
              // row's rowHref navigation.
              render: (row) => {
                if (!row.parentId) return "Top level";
                if (row.parentName) return `Reports to ${row.parentName}`;
                return (
                  <a
                    href={`/crm/accounts/${row.parentId}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Reports to a parent not shown here
                  </a>
                );
              },
            },
            {
              key: "ownerId",
              label: tOwner("columnOwner"),
              // F5-01: show the resolved owner name (or "Unassigned"), never a
              // raw UUID.
              render: (row) => row.ownerName,
            },
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

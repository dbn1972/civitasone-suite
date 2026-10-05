"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, Segmented, EmptyState, StatCard, StatGrid } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney, humanizeStatus } from "@/lib/formatters";

type Deal = {
  id: string;
  dealName: string;
  contactId?: string | null;
  contactName?: string | null;
  // GAP-CRM-DEALS-04: paise as an exact digit string, never a JS number.
  amount: string;
  stage: string;
  status: string;
  owner: string;
} & Record<string, unknown>;

type DealRow = {
  id: string;
  dealName: string;
  account: string;
  contactId: string | null;
  // Kept as the minor-unit string so the DataTable "amount" cell formats it
  // via formatMoney without any float round-trip.
  amount: string;
  stage: string;
  owner: string;
};

// GAP-CRM-DEALS-01: the Stage column is driven by a canonical-key -> label map
// (the backend/mapper always yields lower-case snake keys like "closed_won", so
// the old case-sensitive `\bWon\b`/`\bLost\b` regex never matched and rows read
// "closed won"). Won -> Concluded and Lost -> Lapsed is the module's vocabulary.
// Unknown keys fall back to humanizeStatus so a new backend stage never renders
// as a raw snake_case token.
const STAGE_LABEL_KEYS: Record<string, string> = {
  prospecting: "stageProspecting",
  qualification: "stageQualification",
  proposal: "stageProposal",
  negotiation: "stageNegotiation",
  closed_won: "stageConcluded",
  closed_lost: "stageLapsed",
};

function stageLabel(stage: string, t: (key: string) => string): string {
  const key = STAGE_LABEL_KEYS[stage];
  return key ? t(key) : humanizeStatus(stage);
}

const SEGMENT_LABEL_KEYS = {
  All: "segAll",
  Open: "segOpen",
  Concluded: "segConcluded",
  Lapsed: "segLapsed",
} as const;

// GAP-CRM-DEALS-02: a lapsed (status "lost") engagement had no segment of its
// own and was counted in no stat card, so it was visible only under "All". Add
// an explicit "Lapsed" segment and a Lapsed stat so lost engagements are
// first-class, matching won/open.
const SEGMENTS = ["All", "Open", "Concluded", "Lapsed"] as const;

function sumAmount(rows: readonly Deal[], predicate: (d: Deal) => boolean): bigint {
  let total = 0n;
  for (const d of rows) {
    if (!predicate(d)) continue;
    // amount is a validated paise digit string; guard anyway so one odd row
    // never throws the whole page.
    if (/^\d+$/.test(d.amount)) total += BigInt(d.amount);
  }
  return total;
}

export function DealsTable({ deals, source = "api" }: { deals: Deal[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Deal[]>(
    "crm.deals",
    deals,
    source,
    (d) => d.length === 0,
  );

  const t = useTranslations("crmDealsTable");
  const [segment, setSegment] = useState<string>("All");

  // GAP-CRM-DEALS-03: the stat cards are computed from the SAME seeded rows the
  // table shows (not a second, independent server read), and show "—" rather
  // than a fabricated 0 / ₹0.00 when the load failed with nothing cached
  // ("error-no-data"). This is the "—" guard used on Accounts/Contacts.
  const errored = provenance === "error-no-data";
  const total = rows.length;
  const openCount = rows.filter((d) => d.status === "open").length;
  const lapsedCount = rows.filter((d) => d.status === "lost").length;
  const pipelineValue = sumAmount(rows, (d) => d.status === "open");
  const wonValue = sumAmount(rows, (d) => d.status === "won");

  const totalDisplay = errored ? "—" : total.toLocaleString("en-IN");
  const openDisplay = errored ? "—" : openCount.toLocaleString("en-IN");
  const lapsedDisplay = errored ? "—" : lapsedCount.toLocaleString("en-IN");
  const pipelineDisplay = errored ? "—" : formatMoney(pipelineValue);
  const wonDisplay = errored ? "—" : formatMoney(wonValue);

  const tableRows: DealRow[] = rows
    .filter((d) => {
      if (segment === "Open") return d.status === "open";
      if (segment === "Concluded") return d.status === "won";
      if (segment === "Lapsed") return d.status === "lost";
      return true;
    })
    .map((d) => ({
      id: d.id,
      dealName: d.dealName,
      account: d.contactName ?? "—",
      contactId: d.contactId ?? null,
      amount: d.amount,
      stage: stageLabel(d.stage, (k) => t(k)),
      owner: d.owner,
    }));

  function exportCsv() {
    const header = ["Engagement", t("contactCompany"), "Value", "Stage", "Owner"];
    const lines = tableRows.map((r) =>
      [r.dealName, r.account, formatMoney(r.amount), r.stage, r.owner]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engagements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  // Keep a reference so an accidental unused-var lint never fires if the inline
  // DataTable export is used instead; exportCsv remains available for callers.
  void exportCsv;

  // GAP-CRM-DEALS-05: the column shows contactName ?? company (a person or an
  // organisation), so it is "Contact / Company", not "Account", and the name
  // links to the contact when a contactId exists. The row itself opens the
  // deal, so the cell link stops propagation; "—" (no contact) renders plain.
  function contactCell(row: DealRow): ReactNode {
    if (row.contactId) {
      return (
        <a
          href={`/crm/contacts/${row.contactId}`}
          onClick={(e) => e.stopPropagation()}
          style={{ color: "var(--primary, #2563eb)", textDecoration: "underline" }}
        >
          {row.account}
        </a>
      );
    }
    return <span>{row.account}</span>;
  }

  return (
    <>
      {/* GAP-CRM-DEALS-03: the badge is the single provenance source (same
          useSeededResource call as the stats + table) and sits ABOVE the stat
          grid, so it can never disagree with the figures below it. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <StatGrid>
        <StatCard icon="▣" iconBg="#eef2ff" label={t("statTotal")} value={totalDisplay} />
        <StatCard icon="◉" iconBg="#ecfdf3" label={t("statActive")} value={openDisplay} />
        <StatCard icon="◈" iconBg="#f3e8ff" label={t("statActiveValue")} value={pipelineDisplay} />
        <StatCard icon="△" iconBg="#ecfdf3" label={t("statConcludedValue")} value={wonDisplay} />
        <StatCard icon="▽" iconBg="#fef2f2" label={t("statLapsed")} value={lapsedDisplay} />
      </StatGrid>
      <div className="card">
        <div className="card-h" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ marginRight: "auto" }}>Engagements</h3>
          <Segmented
            options={SEGMENTS.map((s) => t(SEGMENT_LABEL_KEYS[s]))}
            value={t(SEGMENT_LABEL_KEYS[segment as (typeof SEGMENTS)[number]] ?? "segAll")}
            onChange={(label) => setSegment(SEGMENTS.find((s) => t(SEGMENT_LABEL_KEYS[s]) === label) ?? "All")}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="◈" title="No engagements found" message="Start adding engagements to track your procurement pipeline." />
        ) : (
          <DataTable<DealRow>
            columns={[
              { key: "dealName", label: "Engagement" },
              { key: "account", label: t("contactCompany"), render: contactCell },
              { key: "amount", label: "Value", align: "right", cellType: "amount" },
              { key: "stage", label: "Stage", cellType: "status" },
              { key: "owner", label: "Owner" },
            ]}
            rows={tableRows}
            rowHref={(row) => `/crm/deals/${row.id}`}
            sortable
            filterable
            filterPlaceholder="Filter engagements…"
            exportable
            exportFilename="engagements"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { UCSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { ucMatchesScheme } from "./ucScheme";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

// UX-017 (tranche 10): same tab-identity fix as AdvancesTable.tsx -- TABS
// used to double as both <Segmented>'s displayed text AND the filter
// identity (TAB_STATUS_MAP[activeTab]); translating the strings in place
// would have silently broken filtering under hi.json (the same class of bug
// tranche 5 found in PfmsConsole.tsx). Tracked by position instead.
const TAB_STATUS_MAP: string[][] = [
  [], // All
  ["pending"], // Pending (a rejected UC is NOT "not yet submitted" -- own tab below)
  ["submitted", "verified"], // Submitted
  ["rejected"], // Returned / Rejected
];

type Row = UCSummary & { period: string; actions: string; remarks: string };

/** "from – to", or "—" when either end is missing (never "undefined – undefined"). */
export function ucPeriod(from?: string | null, to?: string | null): string {
  return from && to ? `${from} – ${to}` : "—";
}

/**
 * fp-finance-01: what the viewer may do to one certificate. The server is the
 * authority (finance_admin/super_admin verify or return a SUBMITTED certificate,
 * and never their own while the second-approver setting is on); this only avoids
 * offering a button that would be refused. A returned certificate is resubmitted
 * by finance staff.
 */
export function ucRowActions(
  uc: Pick<UCSummary, "status" | "createdBy">,
  viewer: { id: string | null; canVerify: boolean; canResubmit: boolean },
): "verify" | "resubmit" | "none" {
  if (uc.status === "submitted" && viewer.canVerify && (viewer.id === null || uc.createdBy !== viewer.id)) return "verify";
  if (uc.status === "rejected" && viewer.canResubmit) return "resubmit";
  return "none";
}

export function UCsTable({
  ucs,
  source = "api",
  viewerId = null,
  canVerify = false,
  canResubmit = false,
  scheme,
}: {
  ucs: UCSummary[];
  source?: "api" | "error";
  viewerId?: string | null;
  canVerify?: boolean;
  canResubmit?: boolean;
  scheme?: string;
}) {
  const t = useTranslations("expenditureUtilizationCertificatesTable");
  const router = useRouter();

  async function act(id: string, action: "verify" | "reject" | "resubmit", body: Record<string, unknown> = {}) {
    const res = await browserFetch(`v1/finance/utilization-certificates/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const code = await errorCodeFromResponse(res);
    if (code === "MAKER_CHECKER_VIOLATION") throw new Error(t("errSelfVerify"));
    if (code === "UC_NOT_SUBMITTED" || code === "UC_NOT_REJECTED") throw new Error(t("errAlreadyDecided"));
    throw new Error(await errorMessageFromResponse(res, "save", t("area")));
  }

  const TABS = [t("tabAll"), t("tabPending"), t("tabSubmitted"), t("tabRejected")];
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<UCSummary[]>(
    "finance.ucs",
    ucs,
    source,
    (d) => d.length === 0,
  );

  const bySchemeRows = scheme ? rows.filter((u) => ucMatchesScheme(u, scheme)) : rows;
  const filtered =
    activeTabIndex === 0
      ? bySchemeRows
      : bySchemeRows.filter((u) => TAB_STATUS_MAP[activeTabIndex].includes(u.status));

  const tableRows: Row[] = filtered.map((u) => ({
    ...u, period: ucPeriod(u.periodFrom, u.periodTo), actions: u.id, remarks: u.status === "rejected" ? (u.rejectionReason ?? "") : "",
  }));

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={TABS}
          value={TABS[activeTabIndex]}
          onChange={(v) => {
            const idx = TABS.indexOf(v);
            if (idx !== -1) setActiveTabIndex(idx);
          }}
        />
      </div>

      <DataTable<Row>
        columns={[
          { key: "ucNo", label: t("colUcNo"), render: (u) => <span className="mono">{u.ucNo}</span> },
          { key: "grantee", label: t("colGrantee") },
          { key: "grantRef", label: t("colGrantRef"), render: (u) => u.grantRef ?? "—" },
          { key: "period", label: t("colPeriod") },
          { key: "amount", label: t("colAmount"), align: "right", cellType: "amount" },
          { key: "submittedDate", label: t("colSubmitted"), render: (u) => formatIndianDate(u.submittedDate) },
          { key: "status", label: t("colStatus"), cellType: "status" },
          { key: "remarks", label: t("colRemarks"), render: (u) => (u.status === "rejected" ? (u.rejectionReason || t("noReason")) : "—") },
          {
            key: "actions",
            label: t("colActions"),
            render: (u) => {
              const what = ucRowActions(u, { id: viewerId, canVerify, canResubmit });
              if (what === "verify") {
                return (
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <ActionButton
                      label={t("verify")}
                      confirmTitle={t("verifyTitle", { ucNo: u.ucNo })}
                      confirmDescription={t("verifyHelp")}
                      confirmLabel={t("verify")}
                      onConfirm={() => act(u.id, "verify")}
                      onSuccess={() => router.refresh()}
                    />
                    <ActionButton
                      label={t("returnUc")}
                      className="btn ghost"
                      danger
                      confirmTitle={t("returnTitle", { ucNo: u.ucNo })}
                      confirmLabel={t("returnUc")}
                      requireReason
                      reasonLabel={t("returnReason")}
                      minReasonLength={5}
                      maxReasonLength={500}
                      onConfirm={(reason) => act(u.id, "reject", { reason: reason ?? "" })}
                      onSuccess={() => router.refresh()}
                    />
                  </span>
                );
              }
              if (what === "resubmit") {
                return (
                  <ActionButton
                    label={t("resubmit")}
                    confirmTitle={t("resubmitTitle", { ucNo: u.ucNo })}
                    confirmDescription={t("resubmitHelp")}
                    confirmLabel={t("resubmit")}
                    optionalReason
                    reasonLabel={t("resubmitNote")}
                    maxReasonLength={500}
                    onConfirm={(note) => act(u.id, "resubmit", note ? { note } : {})}
                    onSuccess={() => router.refresh()}
                  />
                );
              }
              return "—";
            },
          },
        ]}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
      />
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney, formatIndianDate, daysUntilIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { EmdBgEntry } from "../../../_data/loaders";

type EmdRow = {
  id: string;
  vendor: string;
  type: string;
  amount: string;
  validity: string;
  expiry: string;
  /** Whole days until validity ends (IST); null when unparseable. Drives the 30-day filter. */
  daysLeft: number | null;
  bank: string;
  status: string;
} & Record<string, unknown>;

type Props = {
  emdEntries: EmdBgEntry[];
  pbgEntries: EmdBgEntry[];
  emdSource?: "api" | "error";
  pbgSource?: "api" | "error";
};

/**
 * GAP-PROCUREMENT-EMD-BG-05: a plain-language expiry cue computed from the
 * `validity` date (text + wording, never colour alone), so a clerk sees how
 * long a security instrument has left rather than a raw date string. "—" when
 * there is no parseable date.
 */
function expiryLabel(validity: string): string {
  const days = daysUntilIST(validity);
  if (days === null) return "—";
  if (days < 0) return `Expired ${-days} day${-days === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function toRows(entries: EmdBgEntry[]): EmdRow[] {
  return entries.map((e) => ({
    id: e.id,
    vendor: e.vendor,
    type: e.type,
    // GAP-PROCUREMENT-EMD-BG-03: formatMoney (BigInt paise, Indian grouping,
    // always 2 decimals) — the old `₹${amount/100 .toLocaleString()}` dropped
    // trailing paise zeros (₹1,250.5) and rounded differently from every other
    // procurement page.
    amount: formatMoney(e.amount),
    // GAP-PROCUREMENT-EMD-BG-05: dd Mon yyyy, not the raw backend string.
    validity: formatIndianDate(e.validity),
    expiry: expiryLabel(e.validity),
    daysLeft: daysUntilIST(e.validity),
    bank: e.bank,
    status: e.status,
  }));
}

function activeCount(entries: EmdBgEntry[]): number {
  return entries.filter((e) => e.status === "Active").length;
}

function activeTotalPaise(entries: EmdBgEntry[]): number {
  return entries.filter((e) => e.status === "Active").reduce((sum, e) => sum + e.amount, 0);
}

export function EmdBgTable({ emdEntries, pbgEntries, emdSource = "api", pbgSource = "api" }: Props) {
  // GAP-PROCUREMENT-EMD-BG-01: each register is cached and recovered under its
  // OWN key, so a partial failure falls back (or fails) per register instead
  // of one outage poisoning both.
  const t = useTranslations("procurement.emdBg");
  // GAP-PROCUREMENT-EMD-BG-05: "expiring within 30 days" filter - an instrument
  // is live security, so the clerk needs the ones about to lapse in one click.
  const [expiringOnly, setExpiringOnly] = useState(false);
  const emd = useSeededResource<EmdBgEntry[]>("procurement.emd", emdEntries, emdSource, (d) => d.length === 0);
  const pbg = useSeededResource<EmdBgEntry[]>("procurement.pbg", pbgEntries, pbgSource, (d) => d.length === 0);

  const emdErrored = emd.provenance === "error-no-data";
  const pbgErrored = pbg.provenance === "error-no-data";

  const emdRows = useMemo(() => toRows(emd.data), [emd.data]);
  const pbgRows = useMemo(() => toRows(pbg.data), [pbg.data]);
  const allRows = useMemo(() => [...emdRows, ...pbgRows], [emdRows, pbgRows]);
  const shownRows = useMemo(
    () => (expiringOnly ? allRows.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30) : allRows),
    [allRows, expiringOnly],
  );

  // GAP-PROCUREMENT-EMD-BG-02/04: stats are derived from the SAME rows the
  // tables render, split per instrument. An EMD is NOT a guarantee, so the
  // counts are kept separate and labelled accurately. A register that errored
  // (no data at all) reads "—", never a fabricated 0 that looks complete.
  const activeEmd = emdErrored ? "—" : activeCount(emd.data);
  const activePbg = pbgErrored ? "—" : activeCount(pbg.data);
  // GAP-PROCUREMENT-EMD-BG-02: a COMBINED total is only honest when both
  // registers loaded; otherwise it would silently understate the security held.
  const combinedTotal =
    emdErrored || pbgErrored ? "—" : formatMoney(activeTotalPaise(emd.data) + activeTotalPaise(pbg.data));
  const expired = emdErrored || pbgErrored
    ? "—"
    : [...emd.data, ...pbg.data].filter((e) => e.status === "Expired").length;
  const forfeited = emdErrored || pbgErrored
    ? "—"
    : [...emd.data, ...pbg.data].filter((e) => e.status === "Forfeited").length;

  return (
    <>
      <StatGrid>
        <StatCard icon="🏦" tone="info" label="Active Bank Guarantees" value={activePbg} />
        <StatCard icon="💵" tone="good" label="Active EMD" value={activeEmd} />
        <StatCard icon="🔐" tone="info" label="Total Active Security (EMD + BG)" value={combinedTotal} />
        <StatCard icon="⚠️" tone="warn" label="Expired" value={expired} />
        <StatCard icon="🚫" tone="bad" label="Forfeited" value={forfeited} />
      </StatGrid>

      {/* GAP-PROCUREMENT-EMD-BG-01: name the register that failed, with a real
          retry, rather than a blanket "showing nothing" over surviving rows. */}
      {emdErrored ? (
        <Card title="Earnest money deposits">
          <RefreshErrorState error={toHumanError("load", { area: "earnest money deposits" })} />
        </Card>
      ) : null}
      {pbgErrored ? (
        <Card title="Bank guarantees">
          <RefreshErrorState error={toHumanError("load", { area: "bank guarantees" })} />
        </Card>
      ) : null}

      {!emdErrored || !pbgErrored ? (
        <Card title="EMD & BG Register">
          {/* One honest provenance note per shown dataset (UX-002). */}
          {emd.provenance === "cached" ? (
            <DataSourceBadge provenance="cached" cachedAt={emd.cachedAt} offline={emd.offline} />
          ) : null}
          {pbg.provenance === "cached" ? (
            <DataSourceBadge provenance="cached" cachedAt={pbg.cachedAt} offline={pbg.offline} />
          ) : null}
          {allRows.length === 0 ? (
            <EmptyState
              icon="🏦"
              title="No EMD/BG records"
              message="Earnest money deposits and bank guarantees will appear here."
            />
          ) : (
            <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "0 0 12px", minHeight: 44 }}>
              <input type="checkbox" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} style={{ width: 18, height: 18 }} />
              <span>{t("filterExpiring")}</span>
            </label>
            {expiringOnly ? (
              <p role="status" style={{ margin: "0 0 12px", fontSize: "0.875rem" }}>
                {t("filterShowing", { count: shownRows.length, total: allRows.length })}
              </p>
            ) : null}
            {expiringOnly && shownRows.length === 0 ? (
              <EmptyState icon="✅" title={t("noneExpiringTitle")} message={t("noneExpiringMessage")} />
            ) : (
            <DataTable<EmdRow>
              rows={shownRows}
              sortable
              filterable
              filterPlaceholder="Search vendor, bank, type…"
              pageSize={15}
              exportable exportAudit="procurement/emd-bg"
              exportFilename="emd-bank-guarantees"
              columns={[
                { key: "vendor", label: "Vendor" },
                { key: "type", label: "Type" },
                // GAP-PROCUREMENT-EMD-BG-03: formatMoney already prints ₹, so
                // the column is "Amount", not "Amount (₹)".
                { key: "amount", label: "Amount", align: "right" },
                { key: "validity", label: "Valid Until" },
                { key: "expiry", label: "Expiry" },
                { key: "bank", label: "Bank" },
                { key: "status", label: "Status", cellType: "status" },
              ]}
            />
            )}
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}

"use client";

import { useMemo } from "react";
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
  const emd = useSeededResource<EmdBgEntry[]>("procurement.emd", emdEntries, emdSource, (d) => d.length === 0);
  const pbg = useSeededResource<EmdBgEntry[]>("procurement.pbg", pbgEntries, pbgSource, (d) => d.length === 0);

  const emdErrored = emd.provenance === "error-no-data";
  const pbgErrored = pbg.provenance === "error-no-data";

  const emdRows = useMemo(() => toRows(emd.data), [emd.data]);
  const pbgRows = useMemo(() => toRows(pbg.data), [pbg.data]);
  const allRows = useMemo(() => [...emdRows, ...pbgRows], [emdRows, pbgRows]);

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
        <StatCard icon="🏦" iconBg="#eef2ff" label="Active Bank Guarantees" value={activePbg} />
        <StatCard icon="💵" iconBg="#ecfdf3" label="Active EMD" value={activeEmd} />
        <StatCard icon="🔐" iconBg="#e7edfd" label="Total Active Security (EMD + BG)" value={combinedTotal} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Expired" value={expired} />
        <StatCard icon="🚫" iconBg="#fce7ee" label="Forfeited" value={forfeited} />
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
            <DataTable<EmdRow>
              rows={allRows}
              sortable
              filterable
              filterPlaceholder="Search vendor, bank, type…"
              pageSize={15}
              exportable
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
        </Card>
      ) : null}
    </>
  );
}

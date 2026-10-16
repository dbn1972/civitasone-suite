"use client";
import { useMemo } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { AdminRegister } from "../_components/AdminRegister";
import { meteringStats, meterStatusTone, toMeterRows, type MeterRow } from "./meteringStats";

type RawRow = Record<string, unknown>;
export function MeteringTable({
  meters,
  source = "api",
  errorStatus,
  errorMessage,
}: {
  meters: RawRow[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
}) {
  const { data: raw, provenance, offline, cachedAt } = useSeededResource<RawRow[]>("sa.metering", meters, source, (d) => d.length === 0);
  const rows = useMemo(() => toMeterRows(raw), [raw]);
  const s = meteringStats(rows);
  return (
    // GAP-ADMIN-METERING-03/-04: one data path for cards, badge, failure state and table.
    <AdminRegister
      title="Usage & Billing"
      area="usage metering"
      provenance={provenance ?? "live"}
      cachedAt={cachedAt}
      offline={offline}
      errorStatus={errorStatus}
      errorMessage={errorMessage}
      stats={[
        { icon: "📊", iconBg: "var(--infobg)", label: "Billing periods", value: s.total },
        { icon: "✅", iconBg: "var(--goodbg)", label: "Billed", value: s.billed },
        { icon: "⏳", iconBg: "var(--warnbg)", label: "Pending", value: s.pending },
        { icon: "⚠️", iconBg: "var(--badbg)", label: "Overdue", value: s.overdue },
        { icon: "❔", iconBg: "var(--line2)", label: "Other status", value: s.other, onlyWhenPositive: true },
      ]}
    >
      <DataTable<MeterRow>
        columns={[
          { key: "tenant", label: "Tenant" },
          { key: "apiCalls", label: "API Calls", align: "right" },
          { key: "storage", label: "Storage" },
          { key: "users", label: "Users", align: "right" },
          { key: "billingPeriod", label: "Period" },
          // GAP-ADMIN-METERING-02: billing-service sends integer paise (string);
          // cellType "amount" is formatMoney() -> "₹2,500.50" with lakh grouping.
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} variant={meterStatusTone(r.status)} /> },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search metering…" pageSize={15} exportable exportAudit="admin/metering" exportFilename="usage-metering" emptyIcon="📊" emptyTitle="No metering data" emptyMessage="No usage metering records found."
      />
    </AdminRegister>
  );
}

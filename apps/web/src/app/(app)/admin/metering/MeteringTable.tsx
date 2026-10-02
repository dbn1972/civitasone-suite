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
        { icon: "📊", iconBg: "#eef2ff", label: "Metered Tenants", value: s.total },
        { icon: "✅", iconBg: "#ecfdf3", label: "Billed", value: s.billed },
        { icon: "⏳", iconBg: "#fffaeb", label: "Pending", value: s.pending },
        { icon: "⚠️", iconBg: "#fce7ee", label: "Overdue", value: s.overdue },
        { icon: "❔", iconBg: "#f1f5f9", label: "Other status", value: s.other, onlyWhenPositive: true },
      ]}
    >
      <DataTable<MeterRow>
        columns={[
          { key: "tenant", label: "Tenant" },
          { key: "apiCalls", label: "API Calls", align: "right" },
          { key: "storage", label: "Storage" },
          { key: "users", label: "Users", align: "right" },
          { key: "billingPeriod", label: "Period" },
          // GAP-ADMIN-METERING-02: no billing-service route serves
          // /v1/billing/metering, so the unit of `amount` is unknowable; the
          // header must not assert rupees (billing-service stores paise).
          { key: "amount", label: "Amount", align: "right" },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} variant={meterStatusTone(r.status)} /> },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search metering…" pageSize={15} exportable exportFilename="usage-metering" emptyIcon="📊" emptyTitle="No metering data" emptyMessage="No usage metering records found."
      />
    </AdminRegister>
  );
}

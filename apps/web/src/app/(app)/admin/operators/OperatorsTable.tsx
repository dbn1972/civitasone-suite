"use client";
import { useMemo } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { AdminRegister } from "../_components/AdminRegister";
import { operatorAccountStatus } from "./operatorStatus";
import { operatorStats, permissionList, toOperatorRows, twoFaTone, type OperatorRow } from "./operatorRows";

type RawRow = Record<string, unknown>;
export function OperatorsTable({
  operators,
  source = "api",
  errorStatus,
  errorMessage,
}: {
  operators: RawRow[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
}) {
  const { data: raw, provenance, offline, cachedAt } = useSeededResource<RawRow[]>("sa.operators", operators, source, (d) => d.length === 0);
  const rows = useMemo(() => toOperatorRows(raw), [raw]);
  const s = operatorStats(rows);
  return (
    // GAP-ADMIN-OPERATORS-03/-04: one data path for cards, badge, failure state and table.
    <AdminRegister
      title="Operator Directory"
      area="platform operators"
      provenance={provenance ?? "live"}
      cachedAt={cachedAt}
      offline={offline}
      errorStatus={errorStatus}
      errorMessage={errorMessage}
      stats={[
        { icon: "👤", iconBg: "#eef2ff", label: "Total Operators", value: s.total },
        { icon: "✅", iconBg: "#ecfdf3", label: "Active", value: s.active },
        { icon: "🔐", iconBg: "#fffaeb", label: "2FA Enabled", value: s.twoFa },
        { icon: "⛔", iconBg: "#fce7ee", label: "Suspended", value: s.suspended },
        { icon: "❔", iconBg: "#f1f5f9", label: "Status unknown", value: s.unknown, onlyWhenPositive: true },
      ]}
    >
      <DataTable<OperatorRow>
        columns={[
          { key: "name", label: "Name" },
          { key: "role", label: "Role" },
          { key: "lastLogin", label: "Last Login" },
          {
            key: "status",
            label: "Account status",
            render: (o) => {
              const st = operatorAccountStatus(o);
              return st === "unknown" ? <span aria-label="Account status unknown">—</span> : <StatusPill status={st} />;
            },
          },
          {
            key: "twoFaStatus",
            label: "2FA",
            render: (o) => {
              const t = twoFaTone(o.twoFaStatus);
              return <StatusPill status={t.label} variant={t.variant} />;
            },
          },
          {
            key: "permissions",
            label: "Permissions",
            // GAP-ADMIN-OPERATORS-05: one chip per permission instead of a joined string.
            render: (o) => (
              <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                {permissionList(o.permissions).map((p) => (
                  <span key={p} className="pill mut">{p}</span>
                ))}
              </span>
            ),
          },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search operators…" pageSize={15} exportable exportFilename="operators" emptyIcon="👤" emptyTitle="No operators" emptyMessage="No platform operators configured."
      />
    </AdminRegister>
  );
}

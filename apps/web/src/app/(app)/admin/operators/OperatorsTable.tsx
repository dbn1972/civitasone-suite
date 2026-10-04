"use client";
import { useMemo, useState } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { AdminRegister } from "../_components/AdminRegister";
import { platformExportGuard } from "@/lib/admin/platformExport";
import { operatorAccountStatus } from "./operatorStatus";
import { OperatorRowActions } from "./OperatorRowActions";
import { OperatorRequestsPanel } from "./OperatorRequestsPanel";
import { OperatorGrantButton } from "./OperatorGrantButton";
import { operatorStats, permissionList, toOperatorRows, twoFaTone, type OperatorRow } from "./operatorRows";

type RawRow = Record<string, unknown>;
const exportGuard = platformExportGuard("operators");

export function OperatorsTable({
  operators,
  source = "api",
  errorStatus,
  errorMessage,
  canExport = false,
  canManage = false,
  viewerId = null,
  viewerRoles = [],
  actionsLabel = "Actions",
}: {
  operators: RawRow[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
  /** GAP-ADMIN-OPERATORS-06: platform-operator permission to export. Without it there is no Export button. */
  canExport?: boolean;
  /** GAP-ADMIN-OPERATORS-05: show change requests (suspend / reactivate / role change) and the approvals panel. */
  canManage?: boolean;
  /** The signed-in user, to hide actions on your own row and on your own requests (the server enforces both). */
  viewerId?: string | null;
  viewerRoles?: readonly string[];
  /** Translated heading of the actions column (the page passes it from the adminOperators messages). */
  actionsLabel?: string;
}) {
  const { data: raw, provenance, offline, cachedAt } = useSeededResource<RawRow[]>("sa.operators", operators, source, (d) => d.length === 0);
  const rows = useMemo(() => toOperatorRows(raw), [raw]);
  const [tick, setTick] = useState(0);
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
          // GAP-ADMIN-OPERATORS-06: last-login is behavioural data, so it stays on screen but out of the file.
          { key: "lastLogin", label: "Last Login", csvExclude: true },
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
          ...(canManage
            ? [{
                key: "id" as const,
                label: actionsLabel,
                csvExclude: true,
                render: (o: OperatorRow) => (
                  <OperatorRowActions row={o} viewerId={viewerId} onSent={() => setTick((n) => n + 1)} />
                ),
              }]
            : []),
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search operators…" pageSize={15} exportable={canExport} exportFilename="operators" exportGuard={exportGuard} emptyIcon="👤" emptyTitle="No operators" emptyMessage="No platform operators configured."
      />
      {canManage && (
        <div style={{ marginTop: 16 }}>
          <OperatorGrantButton onSent={() => setTick((n) => n + 1)} />
          <OperatorRequestsPanel viewerId={viewerId} viewerRoles={viewerRoles} tick={tick} />
        </div>
      )}
    </AdminRegister>
  );
}

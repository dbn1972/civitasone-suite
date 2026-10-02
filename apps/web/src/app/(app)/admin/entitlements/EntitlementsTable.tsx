"use client";
import { DataTable, ProgressBar, StatCard } from "@/app/_components/ds";
import { SeededAdminList } from "../_components/SeededAdminList";
import { summarizeEntitlements, toEntitlementRow, type EntitlementRow } from "./entitlementModel";

type RawRow = Record<string, unknown>;

/** GAP-ADMIN-ENTITLEMENTS-04: usage cell -- text + bar + pill, so over-limit is never colour-only. */
function UsageCell({ row }: { row: EntitlementRow }) {
  return (
    <span>
      {row.usage}
      {row.usedPct !== null && <ProgressBar value={row.usedPct} />}
      {row.limitState === "over" && <span className="pill bad">Over limit</span>}
      {row.limitState === "near" && <span className="pill warn">Near limit</span>}
    </span>
  );
}

export function EntitlementsTable({ entitlements, source = "api", unavailable = false }: { entitlements: RawRow[]; source?: "api" | "error"; unavailable?: boolean }) {
  return (
    <SeededAdminList<RawRow>
      cacheKey="sa.entitlements"
      initialRows={entitlements}
      source={source}
      unavailable={unavailable}
      area="entitlements"
      cardTitle="Entitlements"
      stats={(raw) => {
        const s = raw ? summarizeEntitlements(raw.map(toEntitlementRow)) : null;
        return (
          <>
            <StatCard icon="🔑" iconBg="#eef2ff" label="Total Entitlements" value={s?.total ?? null} />
            <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={s?.active ?? null} />
            <StatCard icon="⛔" iconBg="#fffaeb" label="Revoked" value={s?.revoked ?? null} />
            <StatCard icon="⏸️" iconBg="#f2f4f7" label="Other inactive" value={s?.otherInactive ?? null} />
            <StatCard icon="📦" iconBg="#eff6ff" label="Editions" value={s?.editions ?? null} />
            <StatCard icon="⚠️" iconBg="#fef3f2" label="At / over limit" value={s?.atLimit ?? null} />
          </>
        );
      }}
    >
      {(raw) => (
        <DataTable<EntitlementRow>
          columns={[
            { key: "module", label: "Module" },
            { key: "edition", label: "Edition" },
            { key: "tenant", label: "Tenant Override" },
            { key: "limit", label: "Limit" },
            { key: "usage", label: "Used / Limit", render: (r) => <UsageCell row={r} /> },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={raw.map(toEntitlementRow)}
          sortable filterable filterPlaceholder="Search entitlements…" pageSize={15} exportable exportFilename="entitlements"
          emptyIcon="🔑" emptyTitle="No entitlements" emptyMessage="No entitlements configured."
        />
      )}
    </SeededAdminList>
  );
}

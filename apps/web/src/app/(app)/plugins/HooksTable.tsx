"use client";

/**
 * GAP-PLUGINS-HOOKS-01 (theme MISSINGFEATURE): the hooks page used the generic
 * read-only ModuleListPage, which dropped every hook-specific field (owner
 * plugin, enabled/disabled, failures, last run) in mapRows. This dedicated
 * table keeps them: Hook, Event, Owner plugin, Status (StatusPill), Failures
 * and Last run.
 *
 * DECISION (recorded, HUMAN REVIEW): no enable/disable control is rendered.
 * plugin-service exposes only register (POST /v1/plugins/hooks) and deregister
 * (DELETE /v1/plugins/hooks/:id) — there is no per-hook enable/disable verb,
 * and hooks execute tenant code on business events, so inventing a toggle that
 * maps to deregister would be destructive and misleading. The table is
 * read-only until a dedicated, role-gated + audited enable/disable endpoint
 * exists (fail-safe default). A hook with failures > 0 is surfaced with a
 * warning pill so operators can see unhealthy hooks.
 */

import { DataTable, StatusPill } from "../../_components/ds";
import type { PluginHookRow } from "./_data";

export function HooksTable({ rows }: { rows: PluginHookRow[] }) {
  const hasOwner = rows.some((r) => r.ownerPlugin);
  const hasFailures = rows.some((r) => typeof r.failures === "number");
  const hasLastRun = rows.some((r) => r.lastRun);

  const columns: React.ComponentProps<typeof DataTable<PluginHookRow>>["columns"] = [
    { key: "event", label: "Event" },
  ];
  if (hasOwner) columns.push({ key: "ownerPlugin", label: "Owner plugin" });
  columns.push({
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status} />,
  });
  if (hasFailures) {
    columns.push({
      key: "failures",
      label: "Failures",
      align: "right",
      render: (row) =>
        typeof row.failures === "number" && row.failures > 0 ? (
          <StatusPill status="failed" label={`${row.failures}`} />
        ) : (
          <span>{row.failures ?? 0}</span>
        ),
    });
  }
  if (hasLastRun) columns.push({ key: "lastRun", label: "Last run", cellType: "date" });

  return (
    <DataTable<PluginHookRow>
      sortable
      filterable
      filterPlaceholder="Filter hooks…"
      filterKeys={["event", "ownerPlugin"]}
      pageSize={15}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      emptyIcon="🪝"
      emptyTitle="No hooks registered"
      emptyMessage="Plugins that subscribe to business events will list their hooks here."
    />
  );
}

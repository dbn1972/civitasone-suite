"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, ActionButton, Button } from "../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatIndianDateTime } from "@/lib/formatters";

/** One scheduled-report row, as rendered by the table. */
export type ScheduledRow = {
  id: string;
  templateId: string;
  /** Resolved template name (GAP-REPORTS-SCHEDULED-01); falls back to "Unknown template". */
  templateName: string;
  cadence: string;
  recipients: string[];
  format: string;
  enabled: boolean;
  nextRunAt: string | null;
  version: number;
} & Record<string, unknown>;

/**
 * GAP-REPORTS-SCHEDULED-04: recipients were shown only as a count, hiding who
 * receives the report. Show the first address plus "+N more", with the full
 * list in a title tooltip so an admin can see every recipient. (These are
 * admin-only operational addresses on an admin-gated page, not citizen PII.)
 */
function RecipientsCell({ recipients }: { recipients: string[] }) {
  if (recipients.length === 0) return <span style={{ color: "var(--ink2)" }}>—</span>;
  const [first, ...rest] = recipients;
  return (
    <span title={recipients.join(", ")}>
      {first}
      {rest.length > 0 ? <span style={{ color: "var(--ink2)" }}> +{rest.length} more</span> : null}
    </span>
  );
}

/**
 * GAP-REPORTS-SCHEDULED-04: per-row enable/disable, run-now and delete.
 * report-service exposes PATCH (enabled, optimistic-locked via version),
 * DELETE (soft-delete/disable) and POST /:id/run (202) — all role-gated and
 * audited server-side (scheduled/routes.ts + consumer.ts emit audit events).
 * Run-now and delete are confirmed because a run mails the report to external
 * recipients.
 */
function ScheduledRowActions({ row }: { row: ScheduledRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleEnabled() {
    setBusy(true);
    setError("");
    try {
      const res = await browserFetch(`v1/reports/scheduled/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !row.enabled, version: row.version }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res, "save"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const res = await browserFetch(`v1/reports/scheduled/${row.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res, "save"));
  }

  async function runNow() {
    const res = await browserFetch(`v1/reports/scheduled/${row.id}/run`, { method: "POST" });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res, "save"));
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="ghost" onClick={toggleEnabled} disabled={busy} aria-label={row.enabled ? "Disable schedule" : "Enable schedule"}>
        {row.enabled ? "Disable" : "Enable"}
      </Button>
      <ActionButton
        label="Run now"
        className="btn ghost"
        confirmTitle={`Run “${row.templateName}” now?`}
        confirmDescription="This generates the report immediately and emails it to every recipient. It is recorded in the audit trail."
        confirmLabel="Run now"
        onConfirm={runNow}
        onSuccess={() => router.refresh()}
      />
      <ActionButton
        label="Delete"
        className="btn ghost"
        danger
        confirmTitle={`Delete the “${row.templateName}” schedule?`}
        confirmDescription="This disables and removes the schedule. Existing generated reports are not affected. It is recorded in the audit trail."
        confirmLabel="Delete"
        requireReason
        reasonLabel="Reason"
        onConfirm={remove}
        onSuccess={() => router.refresh()}
      />
      {error ? (
        <span role="alert" style={{ color: "var(--bad)", fontSize: "0.8125rem" }}>{error}</span>
      ) : null}
    </div>
  );
}

export function ScheduledTable({ rows }: { rows: ScheduledRow[] }) {
  return (
    <DataTable<ScheduledRow>
      columns={[
        // GAP-REPORTS-SCHEDULED-01: show the template name, not a sliced UUID.
        { key: "templateName", label: "Template" },
        { key: "cadence", label: "Cadence" },
        {
          key: "recipients",
          label: "Recipients",
          render: (row) => <RecipientsCell recipients={row.recipients} />,
        },
        { key: "format", label: "Format" },
        {
          key: "enabled",
          label: "Enabled",
          render: (row) => (
            <span style={{ color: row.enabled ? "var(--good)" : "var(--warn)", fontWeight: 600 }}>
              {row.enabled ? "Yes" : "No"}
            </span>
          ),
        },
        {
          key: "nextRunAt",
          label: "Next Run",
          // GAP-REPORTS-SCHEDULED-05: IST, "dd Mon yyyy, hh:mm am/pm" via the
          // shared helper — not the server-timezone toLocaleString it replaced.
          render: (row) => <span>{row.nextRunAt ? formatIndianDateTime(row.nextRunAt) : "—"}</span>,
        },
        {
          key: "actions",
          label: "Actions",
          render: (row) => <ScheduledRowActions row={row} />,
        },
      ]}
      rows={rows}
      sortable
      pageSize={15}
    />
  );
}

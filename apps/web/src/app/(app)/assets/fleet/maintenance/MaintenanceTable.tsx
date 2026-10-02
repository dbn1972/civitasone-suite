"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, DataTable } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

export type MaintenanceTableRow = {
  id: string;
  vehicle: string;
  typeLabel: string;
  scheduledLabel: string;
  odometerThresholdKm: string;
  /** Display status: scheduled | overdue (derived) | completed | cancelled. */
  statusLabel: string;
  /** True while the job can still be completed or cancelled. */
  open: boolean;
};

type Pending = { row: MaintenanceTableRow; action: "complete" | "cancel" };

/**
 * GAP-ASSETS-FLEET-MAINTENANCE-05: Mark done / Cancel for open jobs
 * (PATCH /v1/assets/fleet/maintenance/:id/complete | /cancel). Cancel is
 * destructive-styled and always confirmed. `canAct` is a UX gate only -- the
 * service stays authoritative (403).
 */
export function MaintenanceTable({ rows, canAct }: { rows: MaintenanceTableRow[]; canAct: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/assets/fleet/maintenance/${encodeURIComponent(pending.row.id)}/${pending.action}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        setDialogError(
          code === "ALREADY_COMPLETED" || code === "ALREADY_CANCELLED"
            ? "This job has already been closed. Close this dialog and refresh the list."
            : await errorMessageFromResponse(res),
        );
        return;
      }
      setMessage(
        pending.action === "complete"
          ? `Marked ${pending.row.typeLabel} for ${pending.row.vehicle} as done. The list updates shortly.`
          : `Cancelled ${pending.row.typeLabel} for ${pending.row.vehicle}. The list updates shortly.`,
      );
      setPending(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns: { key: keyof MaintenanceTableRow; label: string; cellType?: "status"; render?: (r: MaintenanceTableRow) => React.ReactNode }[] = [
    { key: "vehicle", label: "Vehicle" },
    { key: "typeLabel", label: "Type" },
    { key: "scheduledLabel", label: "Scheduled Date" },
    { key: "odometerThresholdKm", label: "Odometer Threshold" },
    { key: "statusLabel", label: "Status", cellType: "status" },
  ];
  if (canAct) {
    columns.push({
      key: "open",
      label: "Actions",
      render: (r) =>
        r.open ? (
          <span style={{ display: "inline-flex", gap: 8 }}>
            <Button type="button" variant="secondary" size="sm" aria-label={`Mark ${r.typeLabel} for ${r.vehicle} as done`} onClick={() => { setDialogError(undefined); setPending({ row: r, action: "complete" }); }}>
              Mark done
            </Button>
            <Button type="button" variant="secondary" size="sm" aria-label={`Cancel ${r.typeLabel} for ${r.vehicle}`} onClick={() => { setDialogError(undefined); setPending({ row: r, action: "cancel" }); }}>
              Cancel
            </Button>
          </span>
        ) : (
          "—"
        ),
    });
  }

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <DataTable<MaintenanceTableRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter by vehicle, type, status…"
        pageSize={15}
        emptyIcon="🛠️"
        emptyTitle="No maintenance scheduled yet"
        emptyMessage="Schedule your first maintenance job using the form above."
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === "cancel" ? "Cancel this maintenance job?" : "Mark this job as done?"}
        confirmLabel={pending?.action === "cancel" ? "Cancel job" : "Mark done"}
        cancelLabel={pending?.action === "cancel" ? "Keep job" : "Cancel"}
        danger={pending?.action === "cancel"}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {pending.action === "cancel" ? "Cancel" : "Mark as completed"} the <strong>{pending.row.typeLabel}</strong> job for{" "}
              <strong>{pending.row.vehicle}</strong> scheduled on <strong>{pending.row.scheduledLabel}</strong>. This is recorded in the audit log.
            </>
          ) : null
        }
        onConfirm={() => void run()}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}

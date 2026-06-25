"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ConfirmDialog } from "../../../../_components/ds";
import type { AttendanceRegularisation } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";

type Decision = "approve" | "reject";
type Row = AttendanceRegularisation & Record<string, unknown>;

export function RegularisationTable({ regs, source = "api" }: { regs: AttendanceRegularisation[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AttendanceRegularisation[]>(
    "hr.attendanceRegularisation",
    regs,
    source,
    (d) => d.length === 0,
  );

  const [pending, setPending] = useState<{ row: Row; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  async function act(id: string, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/attendance/regularisations/${id}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const text = await res.text();
      if (!res.ok) {
        setDialogError(text || `${decision} failed (${res.status})`);
        return;
      }
      setPending(null);
      setToast({ tone: "good", text: decision === "approve" ? "Regularisation approved." : "Regularisation rejected." });
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(
    () => [
      { key: "employeeName" as const, label: "Employee" },
      { key: "date" as const, label: "Date", render: (r: Row) => formatIndianDate(r.date) },
      { key: "reason" as const, label: "Reason" },
      { key: "requestedStatus" as const, label: "Requested Status" },
      { key: "requestedAt" as const, label: "Applied At", render: (r: Row) => formatIndianDate(r.requestedAt) },
      { key: "status" as const, label: "Status", cellType: "status" as const },
      {
        key: "id" as const,
        label: "Decision",
        sortable: false,
        render: (r: Row) =>
          r.status === "pending" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn primary sm" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setPending({ row: r, decision: "approve" }); }}>
                Approve
              </button>
              <button type="button" className="btn ghost sm" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setPending({ row: r, decision: "reject" }); }}>
                Reject
              </button>
            </div>
          ) : (
            <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>
          ),
      },
    ],
    [],
  );

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}
      <DataTable<Row>
        columns={columns}
        rows={rows as Row[]}
        sortable
        filterable
        filterPlaceholder="Filter by employee, reason or status…"
        pageSize={20}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? "Approve regularisation?" : "Reject regularisation?"}
        danger={pending?.decision === "reject"}
        requireReason
        reasonLabel={pending?.decision === "approve" ? "Approval remarks" : "Reason for rejection"}
        confirmLabel={pending?.decision === "approve" ? "Approve" : "Reject"}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {pending.decision === "approve" ? "Approve" : "Reject"} the request from{" "}
              <strong>{pending.row.employeeName}</strong> to mark{" "}
              <strong>{formatIndianDate(pending.row.date)}</strong> as{" "}
              <strong>{pending.row.requestedStatus}</strong>.
              <br />
              <span style={{ color: "var(--ink2)" }}>Reason: {pending.row.reason}</span>
            </>
          ) : null
        }
        onConfirm={(reason) => pending && void act(pending.row.id, pending.decision, reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}

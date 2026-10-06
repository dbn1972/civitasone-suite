"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Button, ConfirmDialog } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

export interface IssuesTableRow extends Record<string, unknown> {
  id: string;
  workId: string;
  work: string;
  description: string;
  raisedDate: string;
  status: string;
}

/**
 * GAP-WORKS-EXECUTION-ISSUES-01/02/04: a close action bound to the row (no
 * UUID typing), a work link, and a resolution note on close. `canClose`
 * gates the control UI-side; the service stays authoritative (403).
 */
export function IssuesTable({ rows, canClose }: { rows: IssuesTableRow[]; canClose: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [target, setTarget] = useState<IssuesTableRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("issue");

  async function handleClose(reason?: string) {
    if (!target) return;
    setBusy(true);
    setError(null);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/works/execution/issues/${encodeURIComponent(target.id)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { resolution: reason } : {}),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }
      toast.success("Issue closed.");
      setTarget(null);
      setBusy(false);
      setTimeout(() => router.refresh(), 400);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  const columns = [
    { key: "work" as const, label: "Work", sortable: true },
    { key: "description" as const, label: "Description", sortable: true },
    { key: "raisedDate" as const, label: "Raised", sortable: true },
    { key: "status" as const, label: "Status", cellType: "status" as const, sortable: true },
    ...(canClose
      ? [
          {
            key: "action" as const,
            label: "",
            render: (row: IssuesTableRow) =>
              row.status === "open" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setTarget(row);
                  }}
                >
                  Close
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search issues..."
        pageSize={20}
        exportable
        exportFilename="works-issues"
        rowLinkKey="workId"
        rowLinkPrefix="/works/execution/"
        identifyingColumnKey="description"
        emptyIcon="🚧"
        emptyTitle="No issues raised"
        emptyMessage="Field issues across works will appear here."
      />
      <ConfirmDialog
        open={!!target}
        title="Close Issue"
        description={target ? `Close "${String(target.description).slice(0, 80)}"? Record how it was resolved.` : ""}
        confirmLabel="Close Issue"
        cancelLabel="Cancel"
        danger
        requireReason
        reasonLabel="Resolution note"
        busy={busy}
        errorMessage={error ?? undefined}
        onConfirm={handleClose}
        onCancel={() => setTarget(null)}
      />
    </>
  );
}

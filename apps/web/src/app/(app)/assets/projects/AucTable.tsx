"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

export type AucRow = {
  id: string;
  projectCode: string;
  name: string;
  wbsRef: string | null;
  accumulatedMinor: number | string;
  status: string;
  assetId: string | null;
} & Record<string, unknown>;

type DisplayRow = AucRow & {
  costDisplay: string;
  statusDisplay: string;
  actions: string;
};

export function AucTable({ rows }: { rows: AucRow[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<AucRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function capitalize(reason?: string) {
    if (!target) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const body = await browserJson<{ id?: string }>(`v1/asset/projects/auc/${target.id}/capitalize`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setMessage(`Capitalization submitted for "${target.projectCode}"${body?.id ? ` — asset ${body.id.slice(0, 8)}` : ""}.`);
      setTarget(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const displayRows: DisplayRow[] = rows.map((r) => ({
    ...r,
    costDisplay: formatMoney(r.accumulatedMinor),
    statusDisplay: r.status.replace(/_/g, " "),
    actions: r.id,
  }));

  const columns = [
    { key: "projectCode" as const, label: "Code" },
    { key: "name" as const, label: "Name" },
    { key: "wbsRef" as const, label: "WBS ref", render: (row: DisplayRow) => row.wbsRef ?? "—" },
    { key: "costDisplay" as const, label: "Accumulated cost", align: "right" as const },
    { key: "statusDisplay" as const, label: "Status", cellType: "status" as const },
    {
      key: "actions" as const,
      label: "",
      sortable: false,
      render: (row: DisplayRow) => {
        if (row.status === "under_construction") {
          return (
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Capitalize project ${row.projectCode}`}
              onClick={() => {
                setDialogError(undefined);
                setTarget(row);
              }}
            >
              Capitalize
            </button>
          );
        }
        if (row.assetId) {
          return <a href={`/assets/${row.assetId}`} aria-label={`View capitalized asset for project ${row.projectCode}`}>View asset</a>;
        }
        return <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>;
      },
    },
  ];

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <DataTable<DisplayRow>
        columns={columns}
        rows={displayRows}
        sortable
        filterable
        filterPlaceholder="Filter by code, name, or status…"
        pageSize={15}
        emptyIcon="🏗️"
        emptyTitle="No AUC projects yet"
        emptyMessage="Create an AUC project above to accumulate WIP before capitalization."
      />

      <ConfirmDialog
        open={target !== null}
        title={target ? `Capitalize "${target.projectCode}"?` : ""}
        confirmLabel="Capitalize to fixed asset"
        danger
        requireReason
        reasonLabel="Reason / authorisation"
        busy={busy}
        errorMessage={dialogError}
        description={
          target ? (
            <>
              This transfers <strong>{formatMoney(target.accumulatedMinor)}</strong> of accumulated WIP from AUC{" "}
              <strong>{target.projectCode}</strong> into the fixed-asset register and starts dual-book depreciation.
              This posts to the GL and <strong>cannot be undone</strong>.
            </>
          ) : null
        }
        onConfirm={(reason) => void capitalize(reason)}
        onCancel={() => {
          if (busy) return;
          setTarget(null);
          setDialogError(undefined);
        }}
      />
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable, ConfirmDialog, Button } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { AttendanceRegularisation } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

type Decision = "approve" | "reject";
type Row = AttendanceRegularisation & Record<string, unknown>;

export function RegularisationTable({ regs, source = "api", canApprove = true }: { regs: AttendanceRegularisation[]; source?: "api" | "error"; canApprove?: boolean }) {
  const t = useTranslations("attendanceRegularisation");
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AttendanceRegularisation[]>(
    "hr.attendanceRegularisation",
    regs,
    source,
    (d) => d.length === 0,
  );

  const [pending, setPending] = useState<{ row: Row; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const formError = useFormError("regularisation request");

  // UX-012: preserve UX-017's existing translation of the cached-state note
  // by feeding it to DataSourceBadge's `message` override rather than
  // falling back to the badge's own hardcoded English default. The
  // error-no-data path had no translated copy before this fix either (the
  // old page-level badge had no `message` prop, so it always rendered the
  // default English text) -- that is unchanged, not a new regression.
  const cachedMessage =
    provenance === "cached"
      ? `${t("cacheNoteShowingSaved")}${cachedAt ? t("cacheNoteFrom", { date: new Date(cachedAt).toLocaleString("en-IN") }) : ""}${offline ? t("cacheNoteOffline") : ""}.`
      : undefined;

  async function act(id: string, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/attendance/regularisations/${id}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }
      setPending(null);
      setToast({ tone: "good", text: decision === "approve" ? t("toastApproved") : t("toastRejected") });
      router.refresh();
    } catch {
      setDialogError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(
    () => [
      { key: "employeeName" as const, label: t("colEmployee") },
      { key: "date" as const, label: t("colDate"), render: (r: Row) => formatIndianDate(r.date) },
      { key: "reason" as const, label: t("colReason") },
      { key: "requestedStatus" as const, label: t("colRequestedStatus") },
      { key: "requestedAt" as const, label: t("colAppliedAt"), render: (r: Row) => formatIndianDate(r.requestedAt) },
      { key: "status" as const, label: t("colStatus"), cellType: "status" as const },
      {
        key: "id" as const,
        label: t("colDecision"),
        sortable: false,
        render: (r: Row) =>
          !canApprove ? (
            <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>
          ) :
          r.status === "pending" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary" size="sm" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setPending({ row: r, decision: "approve" }); }}>
                {t("approveBtn")}
              </Button>
              <Button variant="ghost" size="sm" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setPending({ row: r, decision: "reject" }); }}>
                {t("rejectBtn")}
              </Button>
            </div>
          ) : (
            <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>
          ),
      },
    ],
    [t, canApprove],
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} message={cachedMessage} />
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
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={20}
        emptyIcon="✅"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? t("confirmApproveTitle") : t("confirmRejectTitle")}
        danger={pending?.decision === "reject"}
        requireReason
        reasonLabel={pending?.decision === "approve" ? t("approvalRemarksLabel") : t("rejectionReasonLabel")}
        confirmLabel={pending?.decision === "approve" ? t("approveBtn") : t("rejectBtn")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {t.rich("confirmDescRich", {
                verb: pending.decision === "approve" ? t("approveBtn") : t("rejectBtn"),
                employeeName: pending.row.employeeName,
                date: formatIndianDate(pending.row.date),
                requestedStatus: pending.row.requestedStatus,
                strongName: (chunks) => <strong>{chunks}</strong>,
                strongDate: (chunks) => <strong>{chunks}</strong>,
                strongStatus: (chunks) => <strong>{chunks}</strong>,
              })}
              <br />
              <span style={{ color: "var(--ink2)" }}>{t("reasonLine", { reason: pending.row.reason })}</span>
            </>
          ) : null
        }
        onConfirm={(reason) => pending && void act(pending.row.id, pending.decision, reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}

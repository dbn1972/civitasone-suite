"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Card, DataTable, ConfirmDialog, EmptyState, Button } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";

type WorkflowTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

type LeaveDetail = {
  id: string;
  employeeName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason?: string;
};

/** A workflow task joined with its leave-application context. */
type EnrichedTask = WorkflowTask & {
  employeeName: string;
  leaveType: string;
  dates: string;
  days: number | string;
  reason: string;
} & Record<string, unknown>;

type Decision = "approve" | "reject";

export function LeaveApprovalsPanel() {
  const t = useTranslations("leaveApprovals");
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [leaveById, setLeaveById] = useState<Record<string, LeaveDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "error">("api");
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  // Dialog state
  const [pending, setPending] = useState<{ task: EnrichedTask; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const formError = useFormError("leave application");

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskRes, leaveRes] = await Promise.all([
        fetch("/api/proxy/v1/workflow/tasks?status=pending&limit=50"),
        fetch("/api/proxy/v1/hrms/leave-requests").catch(() => null),
      ]);

      if (!taskRes.ok) {
        const resolved = await formError.fromResponse(taskRes, "load");
        setSource("error");
        throw new Error(resolved.message);
      }
      const taskBody = (await taskRes.json()) as { data?: WorkflowTask[] } | WorkflowTask[];
      const taskRows = Array.isArray(taskBody) ? taskBody : taskBody.data ?? [];
      setTasks(taskRows.filter((wt) => wt.refType === "leave_app" && wt.status === "pending"));

      // Leave context is best-effort: a failure here still shows tasks (with IDs).
      if (leaveRes && leaveRes.ok) {
        const leaveBody = (await leaveRes.json()) as { data?: LeaveDetail[] } | LeaveDetail[];
        const leaveRows = Array.isArray(leaveBody) ? leaveBody : leaveBody.data ?? [];
        const map: Record<string, LeaveDetail> = {};
        for (const l of leaveRows) if (l?.id) map[l.id] = l;
        setLeaveById(map);
      }
    } catch {
      setSource("error");
      setError(formError.fromException("load").message);
    } finally {
      setLoading(false);
    }
    // formError.fromResponse/fromException/clear are stable (useCallback'd on
    // a fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe and
    // avoids re-creating loadTasks (and re-running its effect) every render.
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const enriched: EnrichedTask[] = useMemo(
    () =>
      tasks.map((wt) => {
        const l = wt.refId ? leaveById[wt.refId] : undefined;
        return {
          ...wt,
          employeeName: l?.employeeName ?? "Unknown employee",
          leaveType: l?.leaveType ?? wt.name ?? "—",
          dates: l ? `${formatIndianDate(l.fromDate)} – ${formatIndianDate(l.toDate)}` : "—",
          days: l?.days ?? "—",
          reason: l?.reason ?? "—",
        };
      }),
    [tasks, leaveById],
  );

  async function complete(task: EnrichedTask, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/workflow/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // NOTE: workflow-service's completeTaskBody only accepts { decision } —
        // `reason` here is silently dropped by zod (no .strict()), never
        // persisted, never passed to commands.completeTask (see
        // services/workflow-service/src/modules/tasks/{validators,commands}.ts).
        // The reason is instead recorded as a comment on the leave application
        // below, via the task/comments module that already exists for this.
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }

      let reasonSaved = true;
      if (reason && reason.trim().length > 0) {
        try {
          const commentRes = await fetch("/api/proxy/v1/workflow/comments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              entityType: task.refType || "workflow_task",
              entityId: task.refId || task.id,
              body: `${decision === "approve" ? "Approved" : "Rejected"}: ${reason.trim()}`,
              visibility: "internal",
            }),
          });
          reasonSaved = commentRes.ok;
        } catch {
          reasonSaved = false;
        }
      }

      setPending(null);
      setToast(
        reasonSaved
          ? { tone: "good", text: decision === "approve" ? t("toastApproved") : t("toastRejected") }
          : {
              tone: "bad",
              text: t("toastReasonNotSaved", {
                decision: decision === "approve" ? t("approvedWord") : t("rejectedWord"),
              }),
            },
      );
      await loadTasks();
      router.refresh();
    } catch {
      setDialogError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const columns: {
    key: keyof EnrichedTask & string;
    label: string;
    align?: "left" | "right" | "center";
    sortable?: boolean;
    render?: (row: EnrichedTask) => React.ReactNode;
  }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "leaveType", label: t("colLeaveType") },
    { key: "dates", label: t("colDates") },
    { key: "days", label: t("colDays"), align: "right" },
    { key: "reason", label: t("colReason") },
    {
      key: "id",
      label: t("colDecision"),
      sortable: false,
      render: (row) => (
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="sm"
            style={{ minHeight: 44 }}
            onClick={() => {
              setDialogError(undefined);
              setPending({ task: row, decision: "approve" });
            }}
          >
            {t("approve")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            style={{ minHeight: 44 }}
            onClick={() => {
              setDialogError(undefined);
              setPending({ task: row, decision: "reject" });
            }}
          >
            {t("reject")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}

      <DataSourceBadge source={source} />
      <Card title={t("panelTitle")}>
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }} aria-live="polite">
            {t("loadingTasks")}
          </div>
        ) : error ? (
          <EmptyState
            icon="⚠️"
            title={t("loadErrorTitle")}
            message={error}
            action={
              <Button variant="ghost" onClick={() => void loadTasks()}>
                {t("retry")}
              </Button>
            }
          />
        ) : enriched.length === 0 ? (
          <EmptyState
            icon="✅"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<EnrichedTask>
            columns={columns}
            rows={enriched}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
          />
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? t("approveDialogTitle") : t("rejectDialogTitle")}
        danger={pending?.decision === "reject"}
        requireReason
        reasonLabel={pending?.decision === "approve" ? t("approveRemarksLabel") : t("rejectReasonLabel")}
        confirmLabel={pending?.decision === "approve" ? t("approveConfirmLabel") : t("rejectConfirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {t.rich("description", {
                b: (chunks) => <strong>{chunks}</strong>,
                decision: pending.decision === "approve" ? t("approve") : t("reject"),
                leaveType: pending.task.leaveType,
                employeeName: pending.task.employeeName,
                dates: pending.task.dates,
                dayCount:
                  typeof pending.task.days === "number"
                    ? t("dayCountSuffix", { count: pending.task.days })
                    : "",
              })}
              {pending.task.reason !== "—" && (
                <>
                  <br />
                  <span style={{ color: "var(--ink2)" }}>{t("reasonGiven", { reason: pending.task.reason })}</span>
                </>
              )}
            </>
          ) : null
        }
        onConfirm={(reason) => pending && void complete(pending.task, pending.decision, reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}

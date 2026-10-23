"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, ActionButton, EntityPicker } from "@/app/_components/ds";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { formatShortId } from "@/lib/formatters";

export type InspectionRow = {
  id: string;
  status: string;
};

type RowProps = { id: string; status: string };

type ActionSpec = {
  label: string;
  path: string;
  body?: Record<string, unknown>;
  /**
   * GAP-INSPECTION-INSPECTIONS-04: a sign-off transition that records a
   * finding on the inspection and must capture the officer's own remarks,
   * not a canned "Completed from inspection hub" string. When set, the
   * action is gated behind a ConfirmDialog whose required reason is sent as
   * `body.remarks` (the transition route accepts `remarks: string.max(1000)`
   * — see services/inspection-service/.../execution/routes.ts). Routine,
   * easily-reversible steps (Start / Resume) stay single-click.
   */
  requireRemarks?: boolean;
  confirmTitle?: string;
  confirmDescription?: string;
  reasonLabel?: string;
  irreversible?: boolean;
  /**
   * Hand-off to a reviewer: POSTs `{ reviewerId }` to /submit-review (the only
   * route that records the reviewer; /transition to under_review is rejected
   * by the service). The dialog hosts a reviewer picker.
   */
  pickReviewer?: boolean;
};

function actionForStatus(status: string): ActionSpec | null {
  switch (status) {
    case "scheduled":
      return {
        label: "Start",
        path: "transition",
        body: { targetState: "in_progress", remarks: "Started from inspection hub" },
      };
    case "in_progress":
      return {
        label: "Complete",
        path: "transition",
        body: { targetState: "completed" },
        requireRemarks: true,
        confirmTitle: "Complete this inspection?",
        confirmDescription:
          "Record what you observed. Your remarks are saved to the inspection record and its history.",
        reasonLabel: "Completion remarks",
      };
    case "paused":
      return {
        label: "Resume",
        path: "transition",
        body: { targetState: "in_progress", remarks: "Resumed from inspection hub" },
      };
    case "completed":
      return {
        label: "Submit review",
        path: "submit-review",
        pickReviewer: true,
      };
    case "under_review":
      return { label: "Finalize", path: "finalize", irreversible: true };
    default:
      return null;
  }
}

/** Reviewer hand-off: the dialog hosts a directory picker; Confirm stays disabled until one is chosen. */
function SubmitReviewButton({
  reviewerId,
  onReviewerChange,
  disabled,
  onConfirm,
  onSuccess,
}: {
  reviewerId: string | null;
  onReviewerChange: (id: string | null) => void;
  disabled: boolean;
  onConfirm: () => Promise<void>;
  onSuccess: () => void;
}) {
  const t = useTranslations("inspectionReview");
  return (
    <ActionButton
      label={t("submitLabel")}
      className="btn ghost"
      confirmTitle={t("confirmTitle")}
      confirmDescription={t("confirmDescription")}
      confirmLabel={t("submitLabel")}
      blockConfirm={reviewerId === null}
      disabled={disabled}
      onConfirm={onConfirm}
      onSuccess={onSuccess}
    >
      <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>{t("reviewerLabel")}</label>
      <EntityPicker
        value={reviewerId}
        onChange={(v) => onReviewerChange(typeof v === "string" ? v : null)}
        search={searchDirectoryUsers}
        resolve={resolveDirectoryUsers}
        placeholder={t("reviewerPlaceholder")}
        noResultsText={t("reviewerNoResults")}
        searchingText={t("reviewerSearching")}
        searchErrorText={t("reviewerSearchError")}
      />
    </ActionButton>
  );
}

export function InspectionRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const formError = useFormError("inspection action");
  const [reviewerId, setReviewerId] = useState<string | null>(null);

  // SF-15: a 202 means "received", not "done". Remember the status at the time of
  // the 202 and show the shared AcceptedNotice (with a manual Refresh) instead of a
  // timer that guesses the write has landed (GAP-INSPECTION-CAPA-04 /
  // GAP-INSPECTION-INSPECTIONS-02 asked for an honest "still processing" state).
  const accepted = useAcceptedWrite();
  const [priorStatus, setPriorStatus] = useState<string | null>(null);

  // The server data caught up (status changed): drop the notice.
  useEffect(() => {
    if (priorStatus === null || status === priorStatus) return;
    setMessage("");
    setPriorStatus(null);
    accepted.reset();
  }, [status, priorStatus, accepted]);

  function markAccepted(prior: string): void {
    setPriorStatus(prior);
    accepted.accept();
  }

  const action = actionForStatus(status);
  if (!action) return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;

  // The row action stays disabled after a 202 until the status changes, or the
  // user has pressed Refresh once and it is still unchanged (outcome then
  // visible to them), to prevent queuing a duplicate command before the first
  // one is confirmed as applied.
  const pending = priorStatus !== null && !accepted.noticeProps.refreshed;

  async function callApi(spec: ActionSpec, reason?: string) {
    const body = spec.pickReviewer
      ? { reviewerId }
      : spec.body
      ? spec.requireRemarks && reason
        ? { ...spec.body, remarks: reason }
        : spec.body
      : undefined;
    const res = await fetch(`/api/proxy/v1/inspection/inspections/${id}/${spec.path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  const QUEUED_MESSAGE = "Request sent — the status will update shortly.";

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(undefined);
    setMessage("");
    setPriorStatus(null);
    accepted.reset();
    try {
      await callApi(action);
      setMessage(QUEUED_MESSAGE);
      router.refresh();
      // GAP-INSPECTION-INSPECTIONS-02: follow-up refresh to surface a stale row.
      markAccepted(status);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  if (action.irreversible) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <ActionButton
          label={action.label}
          className="btn ghost"
          confirmTitle="Finalize this inspection?"
          confirmDescription="This locks the inspection's data and generates the final report. It cannot be undone or reopened."
          confirmLabel="Finalize inspection"
          danger
          onConfirm={() => callApi(action)}
          onSuccess={() => {
            setMessage(QUEUED_MESSAGE);
            router.refresh();
            markAccepted(status);
          }}
        />
        {accepted.phase !== "idle" ? (
        <AcceptedNotice {...accepted.noticeProps} message={message} />
      ) : message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
          {message}
        </span>
      ) : null}
      </div>
    );
  }

  if (action.pickReviewer) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SubmitReviewButton
          reviewerId={reviewerId}
          onReviewerChange={setReviewerId}
          disabled={pending}
          onConfirm={() => callApi(action)}
          onSuccess={() => {
            setMessage(QUEUED_MESSAGE);
            setReviewerId(null);
            router.refresh();
            markAccepted(status);
          }}
        />
        {accepted.phase !== "idle" ? (
          <AcceptedNotice {...accepted.noticeProps} message={message} />
        ) : message ? (
          <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
            {message}
          </span>
        ) : null}
      </div>
    );
  }

  if (action.requireRemarks) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <ActionButton
          label={action.label}
          className="btn ghost"
          confirmTitle={action.confirmTitle ?? `${action.label}?`}
          confirmDescription={action.confirmDescription}
          confirmLabel={action.label}
          requireReason
          reasonLabel={action.reasonLabel ?? "Remarks"}
          onConfirm={(reason) => callApi(action, reason)}
          onSuccess={() => {
            setMessage(QUEUED_MESSAGE);
            router.refresh();
            markAccepted(status);
          }}
        />
        {accepted.phase !== "idle" ? (
        <AcceptedNotice {...accepted.noticeProps} message={message} />
      ) : message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
          {message}
        </span>
      ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* GAP-INSPECTION-INSPECTIONS-02: disabled while a poll is in flight to
          prevent duplicate commands while the first one's outcome is unknown. */}
      <button
        type="button"
        className="btn ghost"
        disabled={busy || pending}
        onClick={() => void run()}
      >
        {action.label}
      </button>
      {accepted.phase !== "idle" ? (
        <AcceptedNotice {...accepted.noticeProps} message={message} />
      ) : message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
          {message}
        </span>
      ) : null}
      {error ? (
        <span role="alert" style={{ fontSize: 11, color: "var(--bad)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

type Props = { inspections: InspectionRow[] };

export function InspectionActions({ inspections }: Props) {
  const actionable = inspections.filter((row) => actionForStatus(row.status) !== null);
  if (actionable.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {actionable.map((row) => (
        <div key={row.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, flex: 1 }}>{formatShortId(row.id)}… — {row.status}</span>
          <InspectionRowAction id={row.id} status={row.status} />
        </div>
      ))}
    </div>
  );
}

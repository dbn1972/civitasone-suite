"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ActionButton } from "@/app/_components/ds";
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
        path: "transition",
        body: { targetState: "under_review" },
        requireRemarks: true,
        confirmTitle: "Submit this inspection for review?",
        confirmDescription:
          "Add a note for the reviewing officer. Your remarks are saved to the inspection record and its history.",
        reasonLabel: "Submission remarks",
      };
    case "under_review":
      return { label: "Finalize", path: "finalize", irreversible: true };
    default:
      return null;
  }
}

export function InspectionRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const formError = useFormError("inspection action");

  // GAP-INSPECTION-INSPECTIONS-02: track the status at the time of a 202
  // action so a follow-up refresh can detect whether the async consumer
  // applied the command. The row action is kept disabled while pending.
  const priorStatusRef = useRef<string | null>(null);
  const [pollDue, setPollDue] = useState(false);

  // When the follow-up refresh completes and pollDue is set, compare status.
  useEffect(() => {
    if (!pollDue) return;
    setPollDue(false);
    if (priorStatusRef.current === null) return;
    if (status === priorStatusRef.current) {
      setMessage(
        "Status unchanged — the request may still be processing. Refresh to check again.",
      );
    } else {
      setMessage("");
    }
    priorStatusRef.current = null;
  }, [pollDue, status]);

  // If status changes while a poll is pending (fast consumer), clear immediately.
  useEffect(() => {
    if (priorStatusRef.current === null) return;
    if (status !== priorStatusRef.current) {
      setMessage("");
      priorStatusRef.current = null;
      setPollDue(false);
    }
  }, [status]);

  function scheduleFollowUp(priorStatus: string): void {
    priorStatusRef.current = priorStatus;
    setTimeout(() => {
      router.refresh();
      setPollDue(true);
    }, 5000);
  }

  const action = actionForStatus(status);
  if (!action) return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;

  // The row action stays disabled while a poll is in flight (priorStatusRef
  // is non-null) to prevent the user from queuing a duplicate command before
  // the first one is confirmed as applied.
  const pending = priorStatusRef.current !== null;

  async function callApi(spec: ActionSpec, reason?: string) {
    const body = spec.body
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
    try {
      await callApi(action);
      setMessage(QUEUED_MESSAGE);
      router.refresh();
      // GAP-INSPECTION-INSPECTIONS-02: follow-up refresh to surface a stale row.
      scheduleFollowUp(status);
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
            scheduleFollowUp(status);
          }}
        />
        {message ? (
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
            scheduleFollowUp(status);
          }}
        />
        {message ? (
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
      {message ? (
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

"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

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
  /** Dialog copy for a `requireRemarks` action. */
  confirmTitle?: string;
  confirmDescription?: string;
  reasonLabel?: string;
  /**
   * True only for the one transition with no way back: domain.ts's
   * INSPECTION_TRANSITIONS gives `finalized` an empty transitions array (a
   * true terminal state), and the finalize consumer describes itself as
   * "lock data and transition to finalized". Gated behind a real confirm
   * step (ActionButton/ConfirmDialog) instead of firing on a single click,
   * unlike the other four transitions here which all remain reversible or
   * revisable later in the workflow.
   */
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
      // GAP-INSPECTION-INSPECTIONS-04: Complete records the inspection's
      // outcome — require the inspector to type their own remarks instead of
      // firing a hard-coded string on one click.
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
      // GAP-INSPECTION-INSPECTIONS-04: submitting for review is a sign-off —
      // require the officer's remarks.
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

  const action = actionForStatus(status);
  if (!action) return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;

  async function callApi(spec: ActionSpec, reason?: string) {
    // GAP-INSPECTION-INSPECTIONS-04: for a sign-off action the officer's typed
    // remarks replace the old hard-coded string; merge them into the body.
    const body = spec.body
      ? spec.requireRemarks && reason
        ? { ...spec.body, remarks: reason }
        : spec.body
      : undefined;
    // CRITICAL fix, confirmed live: "Finalize" (under_review -> finalized)
    // has no body, but this used to send `Content-Type: application/json`
    // unconditionally anyway. That header survives the /api/proxy catch-all
    // verbatim (it forwards whatever content-type the browser sent,
    // independent of whether a body existed) and reaches Fastify's default
    // JSON parser, which rejects an empty body under that content-type with
    // 400 FST_ERR_CTP_EMPTY_JSON_BODY — meaning the Finalize button always
    // failed in real use. (The backend's own app.inject()-based integration
    // test missed this because inject() doesn't set a content-type header the
    // way a real fetch() does when none is passed — it only reproduces the
    // bug when the header is explicitly forced, which is what real traffic
    // actually sends.) Only attach Content-Type — and a body — when there's a
    // body to send.
    const res = await fetch(`/api/proxy/v1/inspection/inspections/${id}/${spec.path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  // GAP-INSPECTION-INSPECTIONS-02: the API returns 202 Accepted and the row's
  // state only changes once the async consumer runs, so the old "accepted
  // (queued)" wording read like a terminal success. This honest copy tells the
  // user the request is in flight and the list will reflect it shortly;
  // router.refresh() re-reads the list so the new state appears when ready.
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
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  if (action.irreversible) {
    // Finalize is a true dead end (domain.ts: finalized -> []) that also
    // locks the inspection's data — gate it behind a real confirm step
    // instead of firing on a single click, per the same ActionButton /
    // ConfirmDialog pattern already used for irreversible actions elsewhere
    // in this app (e.g. apps/web/.../assets/[id]/AssetDetailActions.tsx).
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
    // GAP-INSPECTION-INSPECTIONS-04: Complete / Submit review are sign-off
    // steps — gate them behind a ConfirmDialog with REQUIRED remarks (sent as
    // body.remarks) instead of firing a hard-coded string on one click.
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
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void run()}>
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
          <span style={{ fontSize: 13, flex: 1 }}>{row.id.slice(0, 8)}… — {row.status}</span>
          <InspectionRowAction id={row.id} status={row.status} />
        </div>
      ))}
    </div>
  );
}

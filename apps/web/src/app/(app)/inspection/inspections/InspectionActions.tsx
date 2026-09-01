"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/app/_components/ds";

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
      return {
        label: "Complete",
        path: "transition",
        body: { targetState: "completed", remarks: "Completed from inspection hub" },
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
        body: { targetState: "under_review", remarks: "Submitted from inspection hub" },
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

  const action = actionForStatus(status);
  if (!action) return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;

  async function callApi(spec: ActionSpec) {
    // CRITICAL fix, confirmed live: "Finalize" (under_review -> finalized)
    // has no `spec.body`, but this used to send `Content-Type:
    // application/json` unconditionally anyway. That header survives the
    // /api/proxy catch-all verbatim (it forwards whatever content-type the
    // browser sent, independent of whether a body existed) and reaches
    // Fastify's default JSON parser, which rejects an empty body under that
    // content-type with 400 FST_ERR_CTP_EMPTY_JSON_BODY — meaning the
    // Finalize button always failed in real use. (The backend's own
    // app.inject()-based integration test missed this because inject()
    // doesn't set a content-type header the way a real fetch() does when
    // none is passed — it only reproduces the bug when the header is
    // explicitly forced, which is what real traffic actually sends.) Only
    // attach Content-Type — and a body — when there's a body to send.
    const res = await fetch(`/api/proxy/v1/inspection/inspections/${id}/${spec.path}`, {
      method: "POST",
      headers: spec.body ? { "Content-Type": "application/json" } : undefined,
      body: spec.body ? JSON.stringify(spec.body) : undefined,
    });
    if (res.status !== 202 && !res.ok) {
      throw new Error((await res.text()) || "Request failed");
    }
  }

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      await callApi(action);
      setMessage(`${action.label} accepted (queued).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspection action failed");
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
            setMessage(`${action.label} accepted (queued).`);
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

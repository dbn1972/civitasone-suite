"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type Milestone = { id: string; title: string; status: string; dueDate?: string };

type Props = {
  projectId: string;
  milestones: Milestone[];
  /**
   * GAP-PROJECTS-DETAIL-02: whether the signed-in user may complete milestones.
   * Mirrors project-service PROJ_ROLES; the server is the authority (it 403s
   * others). Computed server-side in page.tsx and passed in. When false, no
   * completion control is rendered.
   */
  canComplete: boolean;
};

export function ProjectDetailActions({ projectId, milestones, canComplete }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const formError = useFormError("milestone");

  // GAP-PROJECTS-DETAIL-02: only the NEXT pending milestone (earliest due date)
  // may be completed — not any pending milestone out of sequence. GAP-DETAIL-03:
  // this also collapses the previous unbounded vertical stack of one button per
  // pending milestone into a single header action.
  const next = useMemo<Milestone | null>(() => {
    const pending = milestones.filter((m) => m.status === "pending");
    if (pending.length === 0) return null;
    return [...pending].sort((a, b) => {
      const ta = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
      const tb = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
      return (Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta) - (Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb);
    })[0]!;
  }, [milestones]);

  async function confirmComplete() {
    if (!next) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/projects/${projectId}/milestones/${next.id}/complete`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage(`Milestone “${next.title}” marked complete.`);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (busy) return;
    setOpen(false);
    setError(undefined);
  }

  // No control for viewers (canComplete=false) or when nothing is pending.
  if (!canComplete || !next) {
    return message ? (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
        {message}
      </p>
    ) : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Button
        variant="ghost"
        onClick={() => {
          setError(undefined);
          setMessage("");
          setOpen(true);
        }}
      >
        Complete next milestone: {next.title}
      </Button>
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
          {message}
        </p>
      ) : null}

      <ConfirmDialog
        open={open}
        title="Mark milestone as complete?"
        danger
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              You are about to mark{" "}
              <strong>{next.title}</strong> as complete.
            </p>
            {/* GAP-PROJECTS-DETAIL-02 (HUMAN REVIEW): the previous copy claimed this
                "triggers a fund release ... cannot be undone". The milestone-complete
                consumer only sets the milestone to completed and records an audit
                event — it does NOT release funds. Copy corrected to match the actual
                behaviour; if a fund release is intended it must be built server-side. */}
            <p style={{ margin: 0 }}>
              This records the milestone as completed with today’s date and writes an
              entry to the audit trail.
            </p>
          </>
        }
        confirmLabel="Confirm completion"
        busy={busy}
        errorMessage={error}
        onConfirm={() => void confirmComplete()}
        onCancel={cancel}
      />
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

interface EscalationActionsProps {
  /** The project the escalation concerns (path segment for the action route). */
  projectId: string;
  /** The escalation reference, shown in the confirm recap. */
  escalationId: string;
  /** The escalation's current overlay status (open|submitted|acknowledged|cleared). */
  status: string;
  /** Projection severity/issue, sent so a first-ever action seeds a self-describing record. */
  severity?: string;
  issue?: string;
}

type Action = "acknowledge" | "reassign" | "clear";

const ACTION_LABEL: Record<Action, string> = {
  acknowledge: "Acknowledge",
  reassign: "Reassign",
  clear: "Clear",
};

const SEVERITIES = new Set(["blocked", "overdue", "pending"]);

// GAP-PROJECTS-ESCALATIONS-02: valid actions mirror the server's lifecycle
// (open → acknowledged → cleared; reassign is a side move while not cleared).
// The projection's default status for a non-blocked escalation is "submitted";
// treat it like "open" (unresolved, not yet acknowledged).
function actionsFor(status: string): Action[] {
  const s = status.toLowerCase();
  if (s === "cleared") return [];
  if (s === "acknowledged") return ["reassign", "clear"];
  // open | submitted | anything else unresolved
  return ["acknowledge", "reassign", "clear"];
}

export function EscalationActions({ projectId, escalationId, status, severity, issue }: EscalationActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const assigneeFieldId = useId();
  const formError = useFormError("escalation");

  const available = actionsFor(status);
  if (available.length === 0) return null;

  const assigneeValid = assignee.trim().length >= 2;

  async function handleConfirm(action: Action, reason?: string) {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const snapshot = {
        ...(severity && SEVERITIES.has(severity) ? { severity } : {}),
        ...(issue ? { issue } : {}),
      };
      const body =
        action === "reassign"
          ? { escalatedTo: assignee.trim(), ...(reason ? { reason } : {}), ...snapshot }
          : { ...(reason ? { reason } : {}), ...snapshot };
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/escalation/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setErrorMessage((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }
      setBusy(false);
      setOpen(null);
      setAssignee("");
      setSuccess(
        action === "acknowledge"
          ? `Escalation ${escalationId} acknowledged.`
          : action === "reassign"
            ? `Escalation ${escalationId} reassigned.`
            : `Escalation ${escalationId} cleared.`,
      );
      router.refresh();
    } catch (caught) {
      setErrorMessage(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {available.map((action) => (
        <Button
          key={action}
          variant={action === "clear" ? "primary" : "secondary"}
          style={{ minHeight: 36, fontSize: "0.8125rem" }}
          onClick={(e) => {
            // The row may link to the project; don't navigate on an action click.
            e.stopPropagation();
            setErrorMessage(undefined);
            setAssignee("");
            setOpen(action);
          }}
        >
          {ACTION_LABEL[action]}
        </Button>
      ))}

      {success && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", margin: 0 }}>
          {success}
        </p>
      )}

      {open && (
        <ConfirmDialog
          open
          title={`${ACTION_LABEL[open]} escalation ${escalationId}`}
          description={
            open === "acknowledge" ? (
              <>This marks escalation <strong>{escalationId}</strong> as acknowledged (being worked on).</>
            ) : open === "reassign" ? (
              <>Reassign escalation <strong>{escalationId}</strong> to a new owner.</>
            ) : (
              <>This clears escalation <strong>{escalationId}</strong> (resolved). This cannot be undone.</>
            )
          }
          confirmLabel={ACTION_LABEL[open]}
          // GAP-PROJECTS-ESCALATIONS-02: clearing requires a reason (the
          // resolution note; the server also 400s a reasonless clear). A
          // reassign additionally gates Confirm on a valid new assignee.
          requireReason={open === "clear"}
          reasonLabel={open === "clear" ? "Resolution note (recorded in the audit trail)" : "Reason (optional, recorded in the audit trail)"}
          blockConfirm={open === "reassign" && !assigneeValid}
          busy={busy}
          errorMessage={errorMessage}
          onConfirm={(reason) => void handleConfirm(open, reason)}
          onCancel={() => {
            if (!busy) setOpen(null);
          }}
        >
          {open === "reassign" && (
            <div className="cd-field">
              <label htmlFor={assigneeFieldId}>Reassign to</label>
              <input
                id={assigneeFieldId}
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                aria-invalid={assignee.length > 0 && !assigneeValid}
                placeholder="e.g. Chief Engineer"
              />
              {assignee.length > 0 && !assigneeValid && (
                <p style={{ fontSize: 12, color: "#b42318", margin: "4px 0 0" }}>Enter the new owner (at least 2 characters).</p>
              )}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

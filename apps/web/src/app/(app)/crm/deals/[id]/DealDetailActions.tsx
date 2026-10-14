"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { ActionButton, Button, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { validateActivityForm, type ActivityFormErrors } from "../../activities/activityFormSchema";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

type Props = {
  dealId: string;
  dealName: string;
  contactId?: string;
  status: string;
  /** Server close endpoint is admin-only (CRM_OPPORTUNITY_CLOSE_ROLES); hide Won/Lost for others. */
  canClose?: boolean;
};

export function DealDetailActions({ dealId, dealName, contactId, status, canClose = true }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("activity");
  const [fieldErrors, setFieldErrors] = useState<ActivityFormErrors>({});
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState({ type: "call", subject: "", text: "" });

  const closed = status === "won" || status === "lost";

  /**
   * Close via POST /v1/crm/deals/:id/close (outcome + reason), the same
   * dedicated close endpoint _components/crm/CloseOpportunityDialog.tsx uses
   * for the equivalent action on Opportunities — NOT the generic
   * PATCH .../stage (which requires a version we don't have here and has no
   * `reason` field in its schema at all, so a reason sent there would be
   * silently dropped even though the confirm dialog asks for one and claims
   * it's "recorded in the audit trail").
   *
   * Reason min-length: the backend requires >=10 trimmed chars for any
   * non-"won" outcome (REASON_REQUIRED, 400) — see close-routes.ts. The "Mark
   * Lost" button below passes minReasonLength=10 to ConfirmDialog so the UI
   * enforces the same floor instead of letting a 1-2 char reason round-trip
   * to a server error.
   */
  async function closeDeal(outcome: "won" | "lost", reason?: string) {
    const res = await browserFetch(`v1/crm/deals/${dealId}/close`, {
      method: "POST",
      body: JSON.stringify({ outcome, reason: reason ?? "" }),
    });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    const invalid = validateActivityForm({ subject: activity.subject, text: activity.text });
    setFieldErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    setBusy(true);
    try {
      const res = await browserFetch("v1/crm/activities", {
        method: "POST",
        body: JSON.stringify({
          ...(contactId ? { contactId } : {}),
          dealId,
          type: activity.type,
          subject: activity.subject || activity.text.slice(0, 80),
          text: activity.text,
          status: "completed",
        }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setMessage("Activity logged.");
      setShowActivity(false);
      setActivity({ type: "call", subject: "", text: "" });
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setShowActivity((v) => !v)}>
        Log Activity
      </Button>
      {canClose ? (
      <>
      <ActionButton
        label="Mark Won"
        className="btn ghost"
        disabled={closed}
        confirmTitle={`Mark “${dealName}” as won?`}
        confirmDescription="This closes the deal as won, sets probability to 100% and is recorded in the audit trail."
        confirmLabel="Mark Won"
        requireReason
        reasonLabel="Reason / closing note"
        onConfirm={(reason) => closeDeal("won", reason)}
        onSuccess={() => {
          setMessage("Deal marked won.");
          router.refresh();
        }}
      />
      <ActionButton
        label="Mark Lost"
        className="btn ghost"
        danger
        disabled={closed}
        confirmTitle={`Mark “${dealName}” as lost?`}
        confirmDescription="This closes the deal as lost, sets probability to 0% and is recorded in the audit trail."
        confirmLabel="Mark Lost"
        requireReason
        reasonLabel="Reason for loss"
        minReasonLength={10}
        onConfirm={(reason) => closeDeal("lost", reason)}
        onSuccess={() => {
          setMessage("Deal marked lost.");
          router.refresh();
        }}
      />
      </>
      ) : null}
      {showActivity ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={logActivity} noValidate className="pad">
            <h4 style={{ marginTop: 0 }}>Log activity for {dealName}</h4>
            <Field label="Type" style={{ marginBottom: 8 }}>
              <Select value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })}>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
                <option value="task">Task</option>
                <option value="note">Note</option>
              </Select>
            </Field>
            <Field label="Subject" error={fieldErrors.subject} style={{ marginBottom: 8 }}>
              <Input value={activity.subject} onChange={(e) => setActivity({ ...activity, subject: e.target.value })} placeholder="Short summary" />
            </Field>
            <Field label="Notes" required error={fieldErrors.text} style={{ marginBottom: 8 }}>
              <Textarea value={activity.text} onChange={(e) => setActivity({ ...activity, text: e.target.value })} placeholder="What happened?" rows={3} />
            </Field>
            <Button type="submit" disabled={busy} loading={busy}>
              {busy ? "Saving…" : "Save activity"}
            </Button>
            <Button type="button" variant="ghost" style={{ marginLeft: 8 }} onClick={() => setShowActivity(false)}>
              Cancel
            </Button>
          </form>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 8 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad)", marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

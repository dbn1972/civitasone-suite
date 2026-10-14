"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { ActionButton, Button, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { validateActivityForm, type ActivityFormErrors } from "../../activities/activityFormSchema";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

type Props = { contactId: string; name: string; canDelete?: boolean };

const fieldGap = { marginBottom: 8 } as const;

export function ContactDetailActions({ contactId, name, canDelete = false }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("activity");
  const [fieldErrors, setFieldErrors] = useState<ActivityFormErrors>({});
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState({ type: "call", subject: "", text: "" });

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
          contactId,
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
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * `reason` is the maker-checker deletion note collected by ActionButton's
   * ConfirmDialog. It must be forwarded on the request — the backend threads it
   * through to the contactDeleted audit-trail record (see crm-service
   * modules/contacts/{routes,commands,consumer}.ts) — otherwise the dialog's own
   * "recorded in the audit trail" claim would be false: the user types a reason
   * and it goes nowhere.
   */
  async function deleteContact(reason?: string) {
    const res = await browserFetch(`v1/crm/contacts/${contactId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: reason ?? "" }),
    });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  }

  return (
    <>
      <Button onClick={() => setShowActivity(true)} style={{ minHeight: 44 }}>
        Log Activity
      </Button>
      <a className="btn ghost" href={`/crm/contacts/${contactId}/edit`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
        Edit
      </a>
      {/* GAP-CRM-CONTACTS-DETAIL-03: Delete is an admin-only control
          (crm-service DELETE /v1/crm/contacts/:id requires ADMIN_ROLES =
          crm_admin|super_admin). A normal crm_user used to see a Delete button
          whose 403 only surfaced AFTER they typed a deletion reason. Hide it
          unless the session may delete; the server remains the authority. */}
      {canDelete ? (
        <ActionButton
          label="Delete"
          className="btn danger"
          danger
          requireReason
          reasonLabel="Reason for deletion"
          confirmTitle={`Delete ${name}?`}
          confirmDescription="This removes the contact from the CRM. The action is recorded in the audit trail and cannot be undone here."
          confirmLabel="Delete contact"
          onConfirm={deleteContact}
          onSuccess={() => {
            setMessage("Contact deleted.");
            setTimeout(() => router.push("/crm/contacts"), 500);
          }}
        />
      ) : null}
      {showActivity ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={logActivity} noValidate className="pad" style={{ maxWidth: 520 }}>
            <h4 style={{ marginTop: 0 }}>Log activity for {name}</h4>
            <Field label="Type" style={fieldGap}>
              <Select value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })}>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
                <option value="task">Task</option>
                <option value="note">Note</option>
              </Select>
            </Field>
            <Field label="Subject" error={fieldErrors.subject} style={fieldGap}>
              <Input value={activity.subject} onChange={(e) => setActivity({ ...activity, subject: e.target.value })} placeholder="Short summary" />
            </Field>
            <Field label="Notes" required error={fieldErrors.text} style={fieldGap}>
              <Textarea value={activity.text} onChange={(e) => setActivity({ ...activity, text: e.target.value })} placeholder="What happened?" rows={3} />
            </Field>
            <Button type="submit" disabled={busy} loading={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save activity"}</Button>
            <Button type="button" variant="ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setShowActivity(false)}>Cancel</Button>
          </form>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}

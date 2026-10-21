"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { UserFacingError } from "@/lib/userFacingError";
import { useTranslations } from "next-intl";
import { browserFetch } from "@/lib/api/browserClient";
import { Button, Field, Input, Select, Textarea } from "@/app/_components/ds";
import { validateActivityForm, type ActivityFormErrors } from "./activityFormSchema";
import { LOGGABLE_ACTIVITY_TYPES } from "./activityTypes";

type ContactOption = { id: string; name: string };
type ContactsStatus = "idle" | "loading" | "ready" | "error";

const fieldGap = { marginBottom: 8 } as const;

export function LogActivityButton({
  // GAP-CRM-ACTIVITIES-08: copy is passed from the server page (next-intl) so
  // this client component stays provider-free. Defaults preserve behaviour
  // for any caller that renders it without props (e.g. existing tests).
  buttonLabel = "+ Log Activity",
  heading = "Log an activity",
  savedMessage = "Activity logged.",
}: {
  buttonLabel?: string;
  heading?: string;
  savedMessage?: string;
} = {}) {
  const router = useRouter();
  const tType = useTranslations("crmActivityTypes");
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactsStatus, setContactsStatus] = useState<ContactsStatus>("idle");
  const [form, setForm] = useState({ contactId: "", type: "call", subject: "", text: "", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // The screen, hub tile and header are all "Activities" (GAP-CRM-ACTIVITIES-08), so
  // a failed save reads "We couldn't save your activity", not "interaction".
  const formError = useFormError("activity");
  const [fieldErrors, setFieldErrors] = useState<ActivityFormErrors>({});

  // GAP-CRM-ACTIVITIES-06: do not swallow contact-picker failures. Track a
  // status so the user is told the list could not load (and can retry or save
  // without a contact) instead of silently seeing only "— No contact —".
  const loadContacts = useCallback(async () => {
    setContactsStatus("loading");
    try {
      const res = await browserFetch("v1/crm/contacts");
      if (!res.ok) {
        setContactsStatus("error");
        return;
      }
      const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
      setContacts(
        (body.data ?? [])
          .filter((c): c is { id: string; name: string } => Boolean(c.id && c.name))
          .map((c) => ({ id: c.id, name: c.name })),
      );
      setContactsStatus("ready");
    } catch {
      setContactsStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      // Only reload if we don't already have a ready list.
      if (active) await loadContacts();
    })();
    return () => {
      active = false;
    };
  }, [open, loadContacts]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    const invalid = validateActivityForm({ subject: form.subject, text: form.text });
    setFieldErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    setBusy(true);
    formError.clear();
    try {
      const res = await browserFetch("v1/crm/activities", {
        method: "POST",
        body: JSON.stringify({
          ...(form.contactId ? { contactId: form.contactId } : {}),
          type: form.type,
          subject: form.subject || form.text.slice(0, 80),
          text: form.text,
          status: "open",
          ...(form.dueDate ? { dueDate: form.dueDate } : {}),
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setFieldErrors({ subject: resolved.fieldErrors.subject, text: resolved.fieldErrors.text });
        throw UserFacingError.from(resolved);
      }
      setMessage(savedMessage);
      setForm({ contactId: "", type: "call", subject: "", text: "", dueDate: "" });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  const contactsLoading = contactsStatus === "loading";

  return (
    <>
      <Button onClick={() => setOpen((v) => !v)} style={{ minHeight: 44 }}>
        {buttonLabel}
      </Button>
      {open ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} noValidate className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>{heading}</h4>
            <Field label="Contact (optional)" style={fieldGap}>
              <Select
                value={form.contactId}
                onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                disabled={contactsLoading}
              >
                <option value="">{contactsLoading ? "Loading contacts…" : "— No contact —"}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            {contactsStatus === "error" ? (
              <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: "-4px 0 8px" }}>
                Contacts could not be loaded. You can still save, or{" "}
                <Button type="button" variant="ghost" size="sm" onClick={() => void loadContacts()}>
                  Retry
                </Button>
              </p>
            ) : null}
            <Field label="Type" style={fieldGap}>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {LOGGABLE_ACTIVITY_TYPES.map((type) => (
                  <option key={type} value={type}>{tType(type)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Subject" error={fieldErrors.subject} style={fieldGap}>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary" />
            </Field>
            <Field label="Due date (optional)" style={fieldGap}>
              <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
            <Field label="Notes" required error={fieldErrors.text} style={fieldGap}>
              <Textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="What happened or needs doing?" rows={3} />
            </Field>
            <Button type="submit" disabled={busy} loading={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Save activity"}
            </Button>
            <Button type="button" variant="ghost" style={{ marginInlineStart: 8, minHeight: 44 }} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </form>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 8 }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad)", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { UserFacingError } from "@/lib/userFacingError";
import { useTranslations } from "next-intl";
import { browserFetch } from "@/lib/api/browserClient";
import { Button } from "@/app/_components/ds";
import { LOGGABLE_ACTIVITY_TYPES } from "./activityTypes";

type ContactOption = { id: string; name: string };
type ContactsStatus = "idle" | "loading" | "ready" | "error";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

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
  const formError = useFormError("interaction");

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
    setBusy(true);
    setMessage("");
    setError("");
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
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
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
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>{heading}</h4>
            <label htmlFor="act-contact" style={labelStyle}>Contact (optional)</label>
            <select
              id="act-contact"
              value={form.contactId}
              onChange={(e) => setForm({ ...form, contactId: e.target.value })}
              style={inputStyle}
              disabled={contactsLoading}
            >
              <option value="">{contactsLoading ? "Loading contacts…" : "— No contact —"}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {contactsStatus === "error" ? (
              <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: "-4px 0 8px" }}>
                Contacts could not be loaded. You can still save, or{" "}
                <Button type="button" variant="ghost" size="sm" onClick={() => void loadContacts()}>
                  Retry
                </Button>
              </p>
            ) : null}
            <label htmlFor="act-type" style={labelStyle}>Type</label>
            <select id="act-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle}>
              {LOGGABLE_ACTIVITY_TYPES.map((type) => (
                <option key={type} value={type}>{tType(type)}</option>
              ))}
            </select>
            <label htmlFor="act-subject" style={labelStyle}>Subject</label>
            <input id="act-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary" style={inputStyle} />
            <label htmlFor="act-due" style={labelStyle}>Due date (optional)</label>
            <input id="act-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={inputStyle} />
            <label htmlFor="act-notes" style={labelStyle}>Notes</label>
            <textarea id="act-notes" required value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="What happened or needs doing?" rows={3} style={{ ...inputStyle, minHeight: undefined }} />
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
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}

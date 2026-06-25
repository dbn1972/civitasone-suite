"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { PageHeader, Card, EmptyState, ConfirmDialog } from "../../../_components/ds";

/**
 * Compose / send a notification — wired to POST /notification/send.
 *
 * The send body requires a templateId (uuid) plus a recipient (and optional
 * channel). Templates are loaded from GET /notification/templates to populate a
 * labelled <select>; the recipient and channel are labelled inputs. The send is
 * gated behind the DS ConfirmDialog and the result (accepted / error) is
 * announced through aria-live regions. The endpoint returns 202 Accepted and
 * queues the send asynchronously, so the UI reports "queued", never a fake
 * "delivered".
 */
type Template = {
  id: string;
  name: string;
  channel: string;
  subject?: string | null;
  status?: string;
};

const CHANNELS = [
  { value: "", label: "Use template default" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "in_app", label: "In-app" },
  { value: "push", label: "Push" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

export default function ComposeNotificationPage() {
  const templateFieldId = useId();
  const recipientFieldId = useId();
  const channelFieldId = useId();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [channel, setChannel] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/notification/templates`, {
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const raw = (await res.json()) as unknown;
        const list = Array.isArray(raw)
          ? (raw as Template[])
          : ((raw as { data?: Template[] })?.data ?? []);
        if (active) setTemplates(list);
      } catch {
        if (active) setTemplatesError("Couldn't load templates. Please retry.");
      } finally {
        if (active) setTemplatesLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const canSend = useMemo(
    () => templateId.trim().length > 0 && recipient.trim().length > 0,
    [templateId, recipient],
  );

  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function send() {
    setBusy(true);
    setError(undefined);
    setResult("");
    try {
      const body: Record<string, unknown> = { templateId, recipient: recipient.trim() };
      if (channel) body.channel = channel;
      const res = await fetch(`/api/proxy/notification/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Send failed (HTTP ${res.status})`);
      }
      setConfirmOpen(false);
      setResult("Notification queued. It will appear in Deliveries once the send is processed.");
      setRecipient("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Send notification"
        subtitle="Send a notification from an existing template to a recipient."
        back="/notifications/list"
      />

      <div className="grid g-main" style={{ marginTop: 18 }}>
        <Card title="Compose" padding>
          {templatesError ? (
            <p role="alert" aria-live="assertive" style={{ fontSize: 12, color: "#b91c1c", margin: "0 0 12px" }}>
              {templatesError}
            </p>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) setConfirmOpen(true);
            }}
          >
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={templateFieldId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Template
              </label>
              {templates.length === 0 && !templatesLoading ? (
                <EmptyState
                  icon="📝"
                  title="No templates available"
                  message="Create a notification template before sending. Templates are managed in the notification service."
                  action={<a className="btn ghost" href="/notifications/templates">View templates</a>}
                />
              ) : (
                <select
                  id={templateFieldId}
                  value={templateId}
                  required
                  aria-required="true"
                  onChange={(e) => setTemplateId(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, minHeight: 44 }}
                >
                  <option value="">{templatesLoading ? "Loading templates…" : "Select a template…"}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.channel})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={recipientFieldId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Recipient
              </label>
              <input
                id={recipientFieldId}
                type="text"
                value={recipient}
                required
                aria-required="true"
                aria-describedby={`${recipientFieldId}-help`}
                placeholder="email address, phone number, or user handle"
                onChange={(e) => setRecipient(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, minHeight: 44 }}
              />
              <p id={`${recipientFieldId}-help`} style={{ fontSize: 11, color: "#667085", margin: "4px 0 0" }}>
                Who should receive this notification, matching the selected channel.
              </p>
            </div>

            <div className="field" style={{ marginBottom: 18 }}>
              <label htmlFor={channelFieldId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Channel
              </label>
              <select
                id={channelFieldId}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, minHeight: 44 }}
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn primary" disabled={!canSend || busy} aria-busy={busy} style={{ minHeight: 44 }}>
              {busy ? "Sending…" : "Review & send"}
            </button>
          </form>

          <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", marginTop: 12 }}>{result}</div>
        </Card>

        <Card title="About sending" padding>
          <p style={{ fontSize: 13, color: "#475467", lineHeight: 1.5 }}>
            Sends are processed asynchronously. The service accepts the request (HTTP 202) and queues
            delivery; you can follow its status in <a href="/notifications/deliveries">Deliveries</a>.
          </p>
          {selectedTemplate ? (
            <div style={{ marginTop: 12, fontSize: 12, color: "#667085" }}>
              <div><strong>Selected:</strong> {selectedTemplate.name}</div>
              <div>Channel default: {selectedTemplate.channel}</div>
              {selectedTemplate.subject ? <div>Subject: {selectedTemplate.subject}</div> : null}
            </div>
          ) : null}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Send this notification?"
        description={
          <>
            This sends the <strong>{selectedTemplate?.name ?? "selected"}</strong> template to{" "}
            <strong>{recipient}</strong>{channel ? ` over ${channel}` : ""}. The send is queued immediately.
          </>
        }
        confirmLabel="Send"
        busy={busy}
        errorMessage={error}
        onConfirm={send}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
      />
    </>
  );
}

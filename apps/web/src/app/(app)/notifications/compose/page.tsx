"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, PageHeader, Card, EmptyState, ErrorState, ConfirmDialog } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { email as emailValidator, phone as phoneValidator } from "@/lib/form-validation";

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
 *
 * This page sits behind compose/layout.tsx, a server component that calls
 * requireAnyRole(NOTIFICATION_SEND_ROLES) — the UI gate. notification-service's
 * POST /notifications/send is the real authority (requireRole(NOTIFY_SEND_ROLES)).
 */
type Template = {
  id: string;
  name: string;
  channel: string;
  subject?: string | null;
  body?: string | null;
  status?: string;
  supersededBy?: string | null;
};

const CHANNELS = [
  { value: "", label: "Use template default" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "in_app", label: "In-app" },
  { value: "push", label: "Push" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

/** Human label for a raw channel enum ("in_app" -> "In-app"); falls back to the raw value. */
const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
  push: "Push",
  whatsapp: "WhatsApp",
};
function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.replace(/_/g, " ");
}

/**
 * COMPOSE-03: extract {{placeholder}} variable names from a template body
 * (and subject). Deduplicated, in first-seen order. A template with no
 * placeholders yields an empty list (plain send, no variable inputs).
 */
function extractVariables(...sources: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  for (const src of sources) {
    if (!src) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/** Human label for a variable name ("account_no" -> "Account no"). */
function variableLabel(name: string): string {
  return name
    .replace(/[._]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Substitute {{name}} tokens with provided values for the preview. */
function renderPreview(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, name: string) => {
    const v = values[name];
    return v && v.trim().length > 0 ? v : `{{${name}}}`;
  });
}

/**
 * COMPOSE-04: is `recipient` valid for the effective channel? email channels
 * need an email, sms/whatsapp need an Indian mobile, in_app/push accept a
 * non-empty handle. Returns an error string or undefined when valid.
 */
function recipientError(recipient: string, effectiveChannel: string): string | undefined {
  const v = recipient.trim();
  if (v.length === 0) return "Enter a recipient."; // ux-001-ok: form validation of the operator-typed recipient string, not a fetch result -- no loader involved
  switch (effectiveChannel) {
    case "email":
      return emailValidator()(v);
    case "sms":
    case "whatsapp":
      return phoneValidator()(v);
    default:
      // in_app / push / unknown: a non-empty handle is enough.
      return undefined;
  }
}

export default function ComposeNotificationPage() {
  const templateFieldId = useId();
  const recipientFieldId = useId();
  const channelFieldId = useId();

  // GAP-NOTIFICATIONS-TEMPLATES-DETAIL-01: a "Send with this template" link from
  // a template detail page carries ?templateId=…; preselect it once the list
  // has loaded and it's a real, active template.
  const searchParams = useSearchParams();
  const requestedTemplateId = searchParams?.get("templateId") ?? "";

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);
  const [channel, setChannel] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState("");
  const formError = useFormError("notification");

  useEffect(() => {
    let active = true;
    setTemplatesLoading(true);
    setTemplatesError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/notification/templates`, {
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        // The message text is discarded below regardless (templatesError is
        // always the one catalogued string), but the guard still scans this
        // source line, so it must not embed a raw status either.
        if (!res.ok) throw new Error("Could not load templates.");
        const raw = (await res.json()) as unknown;
        const list = Array.isArray(raw)
          ? (raw as Template[])
          : ((raw as { data?: Template[] })?.data ?? []);
        // DETAIL-01/DETAIL-03 + COMPOSE-02: never offer a superseded template to
        // send from. notification-service already excludes superseded rows from
        // this list (findTemplatesByTenant filters isNull(supersededBy)); this
        // is defence-in-depth in case an older/other build returns them.
        const sendable = list.filter((t) => t.status !== "superseded" && !t.supersededBy);
        if (active) setTemplates(sendable);
      } catch {
        if (active) setTemplatesError("Couldn't load templates. Please retry.");
      } finally {
        if (active) setTemplatesLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadTick]);

  // DETAIL-01: once templates are loaded, preselect the requested template id
  // if it's present in the (sendable) list and nothing is selected yet.
  useEffect(() => {
    if (!requestedTemplateId || templateId) return;
    if (templates.some((t) => t.id === requestedTemplateId)) {
      setTemplateId(requestedTemplateId);
    }
  }, [requestedTemplateId, templates, templateId]);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  // Effective channel = explicit override, else the template's own default.
  const effectiveChannel = channel || selectedTemplate?.channel || "";

  // COMPOSE-03: the variables this template needs, re-derived whenever the
  // selected template changes. Reset the typed values when the template changes
  // so stale values from a previous template never leak into a new send.
  const requiredVariables = useMemo(
    () => (selectedTemplate ? extractVariables(selectedTemplate.body, selectedTemplate.subject) : []),
    [selectedTemplate],
  );
  useEffect(() => {
    setVariables({});
  }, [templateId]);

  const recipientErr = recipientError(recipient, effectiveChannel);
  const allVariablesFilled = requiredVariables.every((name) => (variables[name] ?? "").trim().length > 0);

  const canSend = useMemo(
    () => templateId.trim().length > 0 && recipient.trim().length > 0 && !recipientErr && allVariablesFilled,
    [templateId, recipient, recipientErr, allVariablesFilled],
  );

  const previewBody =
    selectedTemplate?.body && requiredVariables.length > 0
      ? renderPreview(selectedTemplate.body, variables)
      : (selectedTemplate?.body ?? "");

  async function send() {
    setBusy(true);
    setError(undefined);
    setResult("");
    formError.clear();
    try {
      const body: Record<string, unknown> = { templateId, recipient: recipient.trim() };
      if (channel) body.channel = channel;
      if (requiredVariables.length > 0) {
        body.variables = Object.fromEntries(requiredVariables.map((name) => [name, (variables[name] ?? "").trim()]));
      }
      const res = await fetch(`/api/proxy/notification/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setConfirmOpen(false);
      setResult("Notification queued. It will appear in Deliveries once the send is processed.");
      // COMPOSE-05: reset the WHOLE form, not just the recipient, so a stale
      // template/channel/variables set can't be re-sent by accident.
      setRecipient("");
      setRecipientTouched(false);
      setTemplateId("");
      setChannel("");
      setVariables({});
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRecipientTouched(true);
              if (canSend) setConfirmOpen(true);
            }}
          >
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={templateFieldId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Template
              </label>
              {templatesError ? (
                <ErrorState
                  error={toHumanError("load", { area: "templates" })}
                  onRetry={() => setReloadTick((t) => t + 1)}
                />
              ) : templates.length === 0 && !templatesLoading ? (
                <EmptyState
                  icon="📝"
                  title="No templates available"
                  message="Create a notification template before sending."
                  action={<a className="btn ghost" href="/notifications/templates/new">Create a template</a>}
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
                      {t.name} ({channelLabel(t.channel)})
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
                aria-invalid={recipientTouched && !!recipientErr}
                aria-describedby={`${recipientFieldId}-help ${recipientFieldId}-error`}
                placeholder={
                  effectiveChannel === "email"
                    ? "email address"
                    : effectiveChannel === "sms" || effectiveChannel === "whatsapp"
                      ? "10-digit mobile number"
                      : "user handle"
                }
                onChange={(e) => setRecipient(e.target.value)}
                onBlur={() => setRecipientTouched(true)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, minHeight: 44 }}
              />
              <p id={`${recipientFieldId}-help`} style={{ fontSize: 11, color: "#667085", margin: "4px 0 0" }}>
                {effectiveChannel
                  ? `Who should receive this ${channelLabel(effectiveChannel)} notification.`
                  : "Who should receive this notification, matching the selected channel."}
              </p>
              {recipientTouched && recipientErr ? (
                <p id={`${recipientFieldId}-error`} role="alert" style={{ fontSize: 11, color: "#b42318", margin: "4px 0 0" }}>
                  {recipientErr}
                </p>
              ) : null}
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

            {requiredVariables.length > 0 ? (
              <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 18 }}>
                <legend style={{ fontSize: 12, fontWeight: 600, padding: "0 6px" }}>Template details</legend>
                <p style={{ fontSize: 11, color: "#667085", margin: "0 0 10px" }}>
                  This template has placeholders. Fill them in so the recipient doesn&apos;t receive a blank value.
                </p>
                {requiredVariables.map((name) => {
                  const fieldId = `${templateFieldId}-var-${name}`;
                  const value = variables[name] ?? "";
                  return (
                    <div key={name} className="field" style={{ marginBottom: 10 }}>
                      <label htmlFor={fieldId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        {variableLabel(name)}
                      </label>
                      <input
                        id={fieldId}
                        type="text"
                        value={value}
                        required
                        aria-required="true"
                        onChange={(e) => setVariables((prev) => ({ ...prev, [name]: e.target.value }))}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, minHeight: 44 }}
                      />
                    </div>
                  );
                })}
              </fieldset>
            ) : null}

            <Button type="submit" disabled={!canSend || busy} aria-busy={busy} style={{ minHeight: 44 }}>
              {busy ? "Sending…" : "Review & send"}
            </Button>
          </form>

          <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", marginTop: 12 }}>{result}</div>
        </Card>

        <Card title="About sending" padding>
          <p style={{ fontSize: 13, color: "#475467", lineHeight: 1.5 }}>
            Notifications are queued and sent shortly; track them in{" "}
            <a href="/notifications/deliveries">Deliveries</a>.
          </p>
          {selectedTemplate ? (
            <div style={{ marginTop: 12, fontSize: 12, color: "#667085" }}>
              <div><strong>Selected:</strong> {selectedTemplate.name}</div>
              <div>Channel default: {channelLabel(selectedTemplate.channel)}</div>
              {selectedTemplate.subject ? <div>Subject: {selectedTemplate.subject}</div> : null}
              {selectedTemplate.body ? (
                <div style={{ marginTop: 10 }}>
                  <strong>Preview</strong>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", background: "var(--bg-soft, #f8fafc)", padding: 8, borderRadius: 6, marginTop: 4 }}>
                    {previewBody}
                  </pre>
                </div>
              ) : null}
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
            <strong>{recipient}</strong>
            {effectiveChannel ? <> over {channelLabel(effectiveChannel)}</> : null}. The send is queued immediately.
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

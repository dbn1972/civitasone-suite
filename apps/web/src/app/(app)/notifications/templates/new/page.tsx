"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, PageHeader, Card, ConfirmDialog } from "../../../../_components/ds";
import { channelLabel } from "../../_components/channelLabel";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-NOTIFICATIONS-TEMPLATES-01: create a notification template. Wired to the
 * existing, admin-gated POST /notifications/templates endpoint (the service was
 * present all along — only the UI was missing, so wording changes previously
 * needed engineering). Editing an existing template to create a NEW VERSION is
 * handled on the detail page via PATCH; this route is create-only.
 *
 * Validation mirrors the server zod boundary (validators.ts createTemplateBody):
 * channel ∈ {email,sms,push,in_app}, name 1..128, subject ≤256, body required.
 * A light placeholder balance check warns on an unclosed {{…}} before sending.
 */
const CHANNELS = ["email", "sms", "in_app", "push"] as const;

/** Count unbalanced handlebars-style placeholders — a cheap pre-send sanity check. */
function unbalancedPlaceholders(text: string): boolean {
  const opens = (text.match(/\{\{/g) ?? []).length;
  const closes = (text.match(/\}\}/g) ?? []).length;
  return opens !== closes;
}

export default function NewTemplatePage() {
  const router = useRouter();
  const formError = useFormError("template");
  const nameId = useId();
  const channelId = useId();
  const subjectId = useId();
  const bodyId = useId();

  const [channel, setChannel] = useState<string>("email");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const placeholderWarning = useMemo(
    () => unbalancedPlaceholders(subject) || unbalancedPlaceholders(body),
    [subject, body],
  );
  const canSave = name.trim().length > 0 && body.trim().length > 0 && !placeholderWarning;

  async function create() {
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const payload: Record<string, unknown> = { channel, name: name.trim(), body };
      if (subject.trim()) payload.subject = subject.trim();
      const res = await fetch(`/api/proxy/notification/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setConfirmOpen(false);
      router.push("/notifications/templates");
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, minHeight: 44 };

  return (
    <>
      <PageHeader
        title="New notification template"
        subtitle="Create a message template. Templates are managed here and used when sending notifications."
        back="/notifications/templates"
      />
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <Card title="Template" padding>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) setConfirmOpen(true);
            }}
          >
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={nameId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</label>
              <input id={nameId} type="text" value={name} required aria-required="true" maxLength={128}
                onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={channelId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Channel</label>
              <select id={channelId} value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{channelLabel(c)}</option>
                ))}
              </select>
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={subjectId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Subject <span className="muted">(optional)</span>
              </label>
              <input id={subjectId} type="text" value={subject} maxLength={256}
                onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor={bodyId} style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Body</label>
              <textarea id={bodyId} value={body} required aria-required="true" rows={8}
                onChange={(e) => setBody(e.target.value)}
                style={{ ...inputStyle, minHeight: 160, fontFamily: "monospace" }} />
              <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
                Use <code>{"{{placeholder}}"}</code> tokens for dynamic values.
              </p>
            </div>

            {placeholderWarning ? (
              <p role="alert" style={{ fontSize: 12, color: "#b42318", margin: "0 0 12px" }}>
                A placeholder looks unclosed — every <code>{"{{"}</code> needs a matching <code>{"}}"}</code> before you can save.
              </p>
            ) : null}

            <Button type="submit" disabled={!canSave || busy} aria-busy={busy} style={{ minHeight: 44 }}>
              {busy ? "Creating…" : "Review & create"}
            </Button>
            {" "}
            <Link className="btn ghost" href="/notifications/templates">Cancel</Link>
          </form>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this template?"
        description={
          <>
            This creates the <strong>{name || "new"}</strong> template on the{" "}
            <strong>{channelLabel(channel)}</strong> channel. Template wording is sent to citizens — review it carefully.
          </>
        }
        confirmLabel="Create template"
        busy={busy}
        errorMessage={error}
        onConfirm={create}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}

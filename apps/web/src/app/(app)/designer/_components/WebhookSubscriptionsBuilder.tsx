"use client";

/**
 * FN-30 — Service API / Webhook Exposure (B8).
 *
 * The signing secret is WRITE-ONLY here. The API never returns it (queries.ts
 * redacts it to `secretConfigured`), so this panel cannot display one and does
 * not try: an existing subscription shows "Signing secret set" and offers to
 * replace it. A field that rendered the stored value would be both impossible
 * and, if it ever became possible, a place for a secret to be shoulder-surfed
 * out of a browser.
 *
 * The SSRF and event-name rules are enforced server-side at publish. They are
 * mirrored as inline hints — not as blocking client validation — so the designer
 * learns the rule while typing without this file becoming a second, drifting
 * copy of the gate.
 */

import { useState } from "react";

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description?: string;
  /** Returned by the API in place of the secret. */
  secretConfigured?: boolean;
  /** Set only when the designer types a new one; sent, never displayed back. */
  secret?: string;
}

const EVENTS = [
  "application.submitted",
  "application.under_review",
  "application.pending_docs",
  "application.approved",
  "application.rejected",
  "application.issued",
] as const;

export function WebhookSubscriptionsBuilder({
  value,
  onChange,
}: {
  value: WebhookRow[];
  onChange: (next: WebhookRow[]) => void;
}) {
  const [draftId, setDraftId] = useState("");

  const update = (i: number, patch: Partial<WebhookRow>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const toggleEvent = (i: number, event: string) => {
    const row = value[i]!;
    const events = row.events.includes(event)
      ? row.events.filter((e) => e !== event)
      : [...row.events, event];
    update(i, { events });
  };

  const add = () => {
    const id = draftId.trim();
    if (!id) return;
    onChange([...value, { id, url: "", events: ["application.issued"], active: true, secret: "" }]);
    setDraftId("");
  };

  return (
    <section>
      <h2 style={h2}>Inter-agency webhooks</h2>
      <p style={muted}>
        Send application state changes to another agency&apos;s system — for example a police
        verification callback. The payload carries case metadata only: application number,
        service, status, office. It never contains form answers or applicant identity.
      </p>

      {value.length === 0 ? (
        <p style={{ ...muted, fontStyle: "italic" }}>No webhooks configured. This service sends nothing outbound.</p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 16 }}>
        {value.map((row, i) => (
          <li key={row.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <strong>{row.id}</strong>
              <label style={inlineLabel}>
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => update(i, { active: e.target.checked })}
                />
                Active
              </label>
            </div>

            <label style={field}>
              <span style={labelText}>Endpoint URL</span>
              <input
                type="url"
                value={row.url}
                placeholder="https://police.odisha.gov.in/hooks/civitasone"
                onChange={(e) => update(i, { url: e.target.value })}
                style={input}
              />
              <span style={hint}>
                Must be HTTPS and publicly reachable. Internal or private addresses are rejected
                at publish.
              </span>
            </label>

            <fieldset style={{ ...field, border: 0, padding: 0, margin: "12px 0 0" }}>
              <legend style={labelText}>Send on</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                {EVENTS.map((event) => (
                  <label key={event} style={inlineLabel}>
                    <input
                      type="checkbox"
                      checked={row.events.includes(event)}
                      onChange={() => toggleEvent(i, event)}
                    />
                    {event.replace("application.", "")}
                  </label>
                ))}
              </div>
              {row.events.length === 0 ? (
                <span style={{ ...hint, color: "#b42318" }}>
                  Select at least one event — a subscription with none receives nothing.
                </span>
              ) : null}
            </fieldset>

            <label style={field}>
              <span style={labelText}>Signing secret</span>
              <input
                type="password"
                autoComplete="new-password"
                value={row.secret ?? ""}
                placeholder={row.secretConfigured ? "Set — type to replace" : "At least 16 characters"}
                onChange={(e) => update(i, { secret: e.target.value })}
                style={input}
              />
              <span style={hint}>
                {row.secretConfigured
                  ? "A secret is set. It is never shown again; typing here replaces it."
                  : "The receiving agency uses this to verify the callback really came from us."}
              </span>
            </label>

            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 12 }}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              Remove {row.id}
            </button>
          </li>
        ))}
      </ul>

      <div style={{ ...card, marginTop: 16 }}>
        <label style={field}>
          <span style={labelText}>Add a subscription</span>
          <input
            value={draftId}
            placeholder="Name it, e.g. police-verification"
            onChange={(e) => setDraftId(e.target.value)}
            style={input}
          />
        </label>
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={add} disabled={!draftId.trim()}>
          Add webhook
        </button>
      </div>
    </section>
  );
}

const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, margin: "0 0 6px" };
const muted: React.CSSProperties = { color: "var(--mut)", fontSize: 14, margin: 0 };
const card: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: 16 };
const field: React.CSSProperties = { display: "grid", gap: 4, marginTop: 12 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 12, color: "var(--mut)" };
const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)" };
const inlineLabel: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 };

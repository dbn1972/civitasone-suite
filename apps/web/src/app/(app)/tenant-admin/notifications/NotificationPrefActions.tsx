"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState } from "../../../_components/ds";

type Pref = {
  id: string;
  module: string;
  eventType: string;
  label: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  webhookEnabled: boolean;
};

type Channels = { email: boolean; inApp: boolean };

// Backend-persisted defaults (notification-service prefs): email on, in-app on.
const DEFAULTS: Channels = { email: true, inApp: true };

/**
 * Interactive notification channel settings + "Save changes" / "Reset to
 * defaults" for the tenant notification-preferences page. Replaces the dead
 * header buttons and the read-only channel pills.
 *
 * Only Email and In-app are interactive because those are the channels the
 * notification-service actually persists; SMS/Webhook are shown as static
 * "not configured" indicators (the backend does not store them yet). Changed
 * rows are persisted via PATCH /notifications/prefs/:id through the proxy.
 *
 * WCAG: each channel toggle is a real <button role="switch"> with an aria-label
 * and aria-checked; a polite aria-live region announces save status and an
 * assertive region announces errors.
 */
export function NotificationPrefActions({ prefs }: { prefs: Pref[] }) {
  const router = useRouter();

  const initial = useMemo(() => {
    const m: Record<string, Channels> = {};
    for (const p of prefs) m[p.id] = { email: p.emailEnabled, inApp: p.inAppEnabled };
    return m;
  }, [prefs]);

  const [pending, setPending] = useState<Record<string, Channels>>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const byModule = useMemo(() => {
    return prefs.reduce<Record<string, Pref[]>>((acc, p) => {
      (acc[p.module] ??= []).push(p);
      return acc;
    }, {});
  }, [prefs]);

  function isDirty(id: string, next: Record<string, Channels>): boolean {
    return next[id].email !== initial[id].email || next[id].inApp !== initial[id].inApp;
  }

  function toggle(id: string, channel: keyof Channels) {
    setStatus("");
    setError("");
    setPending((p) => ({ ...p, [id]: { ...p[id], [channel]: !p[id][channel] } }));
  }

  async function persist(target: Record<string, Channels>, okVerb: string) {
    const ids = prefs.map((p) => p.id).filter((id) => isDirty(id, target));
    if (ids.length === 0) {
      setStatus("Nothing to save.");
      return;
    }
    setBusy(true);
    setStatus("");
    setError("");
    try {
      for (const id of ids) {
        const res = await fetch(`/api/proxy/notification/prefs/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: target[id].email, inApp: target[id].inApp }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setStatus(`${okVerb} ${ids.length} preference${ids.length === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    void persist(pending, "Saved");
  }

  function resetToDefaults() {
    const next: Record<string, Channels> = {};
    for (const p of prefs) next[p.id] = { ...DEFAULTS };
    setPending(next);
    void persist(next, "Reset");
  }

  const dirty = prefs.some((p) => isDirty(p.id, pending));
  const modules = Object.keys(byModule);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Channel settings</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" disabled={busy} aria-busy={busy} onClick={() => resetToDefaults()}>
            Reset to defaults
          </button>
          <button className="btn primary" disabled={busy || !dirty} aria-busy={busy} onClick={() => save()}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      <div className="pad">
        {modules.length > 0 ? (
          modules.map((mod) => (
            <div key={mod}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#667085", textTransform: "uppercase", letterSpacing: "0.05em", padding: "10px 0 6px" }}>
                {mod.replace(/_/g, " ")}
              </div>
              {(byModule[mod] ?? []).map((pref) => {
                const ch = pending[pref.id];
                return (
                  <div key={pref.id} className="prefrow">
                    <span style={{ fontSize: 13 }}>{pref.label}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <ChannelSwitch label={`Email for ${pref.label}`} on={ch.email} disabled={busy} onClick={() => toggle(pref.id, "email")} text="Email" />
                      <ChannelSwitch label={`In-app for ${pref.label}`} on={ch.inApp} disabled={busy} onClick={() => toggle(pref.id, "inApp")} text="In-app" />
                      {pref.smsEnabled ? <span className="pill info">SMS</span> : null}
                      {pref.webhookEnabled ? <span className="pill info">Webhook</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <EmptyState icon="⚙️" title="No channels" message="Channel settings will appear here." />
        )}
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", marginTop: 8 }}>{status}</div>
        <div role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{error}</div>
      </div>
    </div>
  );
}

function ChannelSwitch({ label, on, disabled, onClick, text }: { label: string; on: boolean; disabled: boolean; onClick: () => void; text: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? "on" : "off"}`}
      disabled={disabled}
      onClick={onClick}
      className={`pill ${on ? "info" : "mut"}`}
      style={{ cursor: disabled ? "default" : "pointer", border: "1px solid var(--line)" }}
    >
      {text}
    </button>
  );
}

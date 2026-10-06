"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, EmptyState, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

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
 * defaults" for the tenant notification-preferences page.
 *
 * Only Email and In-app are interactive because those are the only channels the
 * notification-service persists (see GET /notifications/preferences, which
 * returns smsEnabled/webhookEnabled always false). SMS/Webhook are therefore
 * shown as explicit read-only indicators, never as something the admin can set.
 */
export function NotificationPrefActions({ prefs }: { prefs: Pref[] }) {
  const router = useRouter();

  const initial = useMemo(() => {
    const m: Record<string, Channels> = {};
    for (const p of prefs) m[p.id] = { email: p.emailEnabled, inApp: p.inAppEnabled };
    return m;
  }, [prefs]);

  // GAP-TENANT-ADMIN-NOTIFICATIONS-05: pending must stay in sync with the server
  // props. If router.refresh()/revalidate adds a NEW pref id, `pending[newId]`
  // would be undefined and crash isDirty()/render. Keying the state object by a
  // hash of the current pref ids resets it whenever the set of rows changes, so
  // every rendered row always has a channels entry.
  const prefKey = useMemo(() => prefs.map((p) => p.id).sort().join("|"), [prefs]);
  const [stateKey, setStateKey] = useState(prefKey);
  const [pending, setPending] = useState<Record<string, Channels>>(initial);
  if (stateKey !== prefKey) {
    // Pref set changed under us — adopt the fresh server values.
    setStateKey(prefKey);
    setPending(initial);
  }

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const formError = useFormError("preferences");

  const byModule = useMemo(() => {
    return prefs.reduce<Record<string, Pref[]>>((acc, p) => {
      (acc[p.module] ??= []).push(p);
      return acc;
    }, {});
  }, [prefs]);

  // GAP-TENANT-ADMIN-NOTIFICATIONS-05: fall back to the server `initial` value
  // for any id missing from `pending`, so a freshly-added row never throws.
  function chan(id: string): Channels {
    return pending[id] ?? initial[id] ?? DEFAULTS;
  }

  function isDirty(id: string): boolean {
    const base = initial[id];
    if (!base) return false;
    const c = chan(id);
    return c.email !== base.email || c.inApp !== base.inApp;
  }

  function toggle(id: string, channel: keyof Channels) {
    setStatus("");
    setError("");
    setPending((p) => {
      const cur = p[id] ?? initial[id] ?? DEFAULTS;
      return { ...p, [id]: { ...cur, [channel]: !cur[channel] } };
    });
  }

  // GAP-TENANT-ADMIN-NOTIFICATIONS-02: persist each dirty row, but DO NOT return
  // on the first failure. Track saved vs failed ids; always refresh after any
  // success so the stale `initial` is reconciled with the server; report an
  // honest "Saved X of Y; N failed" and leave only the failed rows dirty so a
  // retry re-sends just those.
  async function save() {
    const ids = prefs.map((p) => p.id).filter((id) => isDirty(id));
    if (ids.length === 0) {
      setStatus("Nothing to save.");
      return;
    }
    setBusy(true);
    setStatus("");
    setError("");
    formError.clear();

    const saved: string[] = [];
    const failed: string[] = [];
    let lastErr = "";
    for (const id of ids) {
      try {
        const c = chan(id);
        const res = await fetch(`/api/proxy/notification/prefs/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: c.email, inApp: c.inApp }),
        });
        if (res.ok) {
          saved.push(id);
        } else {
          failed.push(id);
          lastErr = (await formError.fromResponse(res, "save")).message;
        }
      } catch (caught) {
        failed.push(id);
        lastErr = formError.fromException("save", caught).message;
      }
    }

    setBusy(false);
    if (failed.length === 0) {
      setStatus(`Saved ${saved.length} preference${saved.length === 1 ? "" : "s"}.`);
    } else {
      const labels = failed
        .map((id) => prefs.find((p) => p.id === id)?.label ?? id)
        .join(", ");
      setStatus(saved.length > 0 ? `Saved ${saved.length} of ${ids.length}.` : "");
      setError(`${failed.length} not saved: ${labels}. ${lastErr}`.trim());
    }
    // Reconcile with the server even on partial failure (so saved rows stop
    // showing dirty); the refresh re-seeds `initial`/`pending` via prefKey.
    if (saved.length > 0) router.refresh();
  }

  // GAP-TENANT-ADMIN-NOTIFICATIONS-01: Reset no longer persists on one click. It
  // opens a confirmation (with an optional reason for the record), and on
  // confirm only STAGES the defaults — the admin then reviews and presses Save,
  // which is the audited write. Decision: a per-row preference PATCH has no
  // reason field and threading one through the outbox audit is out of scope for
  // this gap, so Reset stages rather than persisting silently (the safest
  // default: no accidental tenant-wide rewrite, change is explicit + reviewed).
  function applyResetToStage() {
    setStatus("");
    setError("");
    setPending((prev) => {
      const next: Record<string, Channels> = { ...prev };
      for (const p of prefs) next[p.id] = { ...DEFAULTS };
      return next;
    });
    setConfirmReset(false);
    setStatus("Defaults staged. Review the changes and press Save to apply.");
  }

  const dirty = prefs.some((p) => isDirty(p.id));
  const modules = Object.keys(byModule);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Channel settings</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" disabled={busy} aria-busy={busy} onClick={() => setConfirmReset(true)}>
            Reset to defaults
          </Button>
          <Button disabled={busy || !dirty} aria-busy={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
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
                const ch = chan(pref.id);
                return (
                  <div key={pref.id} className="prefrow" data-dirty={isDirty(pref.id) ? "true" : undefined}>
                    <span style={{ fontSize: 13 }}>{pref.label}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <ChannelSwitch label={`Email for ${pref.label}`} on={ch.email} disabled={busy} onClick={() => toggle(pref.id, "email")} text="Email" />
                      <ChannelSwitch label={`In-app for ${pref.label}`} on={ch.inApp} disabled={busy} onClick={() => toggle(pref.id, "inApp")} text="In-app" />
                      {/* GAP-TENANT-ADMIN-NOTIFICATIONS-03: SMS/Webhook are not
                          configurable here (backend does not store them), so
                          they are labelled read-only rather than looking like
                          live toggles. */}
                      {pref.smsEnabled ? <span className="pill mut" title="SMS delivery is read-only here">SMS (read-only)</span> : null}
                      {pref.webhookEnabled ? <span className="pill mut" title="Webhook delivery is read-only here">Webhook (read-only)</span> : null}
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

      <ConfirmDialog
        open={confirmReset}
        title="Reset notification channels to defaults?"
        description={`This stages Email and In-app ON for all ${prefs.length} event${prefs.length === 1 ? "" : "s"}. Nothing is saved until you press Save changes.`}
        confirmLabel="Stage defaults"
        optionalReason
        reasonLabel="Reason (optional, for your records)"
        onConfirm={() => applyResetToStage()}
        onCancel={() => setConfirmReset(false)}
      />
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

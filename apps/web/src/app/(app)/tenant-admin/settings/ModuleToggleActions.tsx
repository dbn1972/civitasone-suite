"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState } from "../../../_components/ds";

type ModuleRow = { moduleKey: string; moduleName: string; enabled: boolean; enabledAt?: string | null };

/**
 * Interactive module-toggle list + "Save changes" for the tenant settings page.
 * Replaces the dead "Save changes" button and the read-only status pills.
 *
 * Each row is a real <button role="switch"> whose aria-checked reflects the
 * pending state. "Save changes" persists every row that differs from the loaded
 * state by POSTing to the admin-service module toggle endpoint via the proxy,
 * then refreshes. WCAG: switches are keyboard-operable buttons with labels, and
 * a polite aria-live region announces save status; errors use an alert region.
 *
 * Audit emission happens server-side in the admin-service consumer that processes
 * the module toggle command — the FE does not emit audit events directly.
 */
export function ModuleToggleActions({ modules }: { modules: ModuleRow[] }) {
  const router = useRouter();
  const initial = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const mod of modules) m[mod.moduleKey] = mod.enabled;
    return m;
  }, [modules]);

  const [pending, setPending] = useState<Record<string, boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const dirtyKeys = modules.filter((mod) => pending[mod.moduleKey] !== initial[mod.moduleKey]).map((m) => m.moduleKey);
  const dirty = dirtyKeys.length > 0;

  function toggle(key: string) {
    setStatus("");
    setError("");
    setPending((p) => ({ ...p, [key]: !p[key] }));
  }

  async function save() {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      for (const key of dirtyKeys) {
        const res = await fetch(`/api/proxy/v1/admin/tenant/modules/${encodeURIComponent(key)}/toggle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: pending[key] }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setStatus(`Saved ${dirtyKeys.length} module${dirtyKeys.length === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>Module toggles</h3>
        <button className="btn primary" disabled={busy || !dirty} aria-busy={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
      <div className="pad">
        {modules.length > 0 ? (
          modules.map((mod) => {
            const on = pending[mod.moduleKey];
            return (
              <div key={mod.moduleKey} className="prefrow">
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{mod.moduleName}</div>
                  <div style={{ fontSize: 12, color: "#98a2b3" }}><span className="mono">{mod.moduleKey}</span></div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${mod.moduleName} module ${on ? "enabled" : "disabled"}`}
                  disabled={busy}
                  onClick={() => toggle(mod.moduleKey)}
                  className={`pill ${on ? "good" : "mut"}`}
                  style={{ cursor: busy ? "default" : "pointer", border: "1px solid var(--line)" }}
                >
                  {on ? "Active" : "Disabled"}
                </button>
              </div>
            );
          })
        ) : (
          <EmptyState icon="🧩" title="No modules" message="Modules will appear here once configured." />
        )}
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", marginTop: 8 }}>{status}</div>
        <div role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{error}</div>
      </div>
    </div>
  );
}

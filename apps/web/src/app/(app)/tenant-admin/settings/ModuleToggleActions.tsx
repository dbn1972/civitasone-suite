"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, EmptyState, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type ModuleRow = { moduleKey: string; moduleName: string; enabled: boolean; enabledAt?: string | null };

/**
 * Interactive module-toggle list + "Save changes" for the tenant settings page.
 *
 * Each row is a real <button role="switch"> whose aria-checked reflects the
 * pending state, rendered as a track+thumb switch with the state shown as text
 * beside it (GAP-TENANT-ADMIN-SETTINGS-06). "Save changes" opens a confirm
 * dialog that lists what is being enabled/disabled and REQUIRES a reason
 * (GAP-TENANT-ADMIN-SETTINGS-02); the reason is sent in the toggle body and the
 * admin-service consumer writes it into the audit event (in the same
 * transaction). Disabling a module is danger-styled because it cuts
 * tenant-wide access.
 *
 * Partial failures (GAP-TENANT-ADMIN-SETTINGS-03): each dirty key is saved and
 * tracked; on any failure we STILL router.refresh() so server state reloads,
 * and report "Saved N of M; <module> failed", rather than stopping at the first
 * error with earlier toggles silently persisted and the UI left stale.
 *
 * DECISION (GAP-TENANT-ADMIN-SETTINGS-01, recorded): the admin-service toggle
 * endpoint deliberately authorises tenant_admin to toggle their own tenant's
 * modules directly (routes.ts TENANT_ADMIN gate) and audits every change; there
 * is NO workflow `module-change-requests` endpoint in workflow-service. The
 * previously-dead ModuleApprovalBanner pointed its "Request Approval" button at
 * that non-existent endpoint, so wiring it in would create a fabricated flow
 * that always 404s. The honest control here is therefore: direct toggle (role-
 * gated + audited server-side) gated behind an explicit confirm + reason.
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("module");

  const nameFor = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mod of modules) m[mod.moduleKey] = mod.moduleName;
    return m;
  }, [modules]);

  const dirtyKeys = modules.filter((mod) => pending[mod.moduleKey] !== initial[mod.moduleKey]).map((m) => m.moduleKey);
  const dirty = dirtyKeys.length > 0;
  const beingDisabled = dirtyKeys.filter((k) => pending[k] === false);
  const beingEnabled = dirtyKeys.filter((k) => pending[k] === true);
  const anyDisable = beingDisabled.length > 0;

  function toggle(key: string) {
    setStatus("");
    setError("");
    setPending((p) => ({ ...p, [key]: !p[key] }));
  }

  async function save(reason?: string) {
    setBusy(true);
    setStatus("");
    setError("");
    formError.clear();
    const succeeded: string[] = [];
    const failed: { key: string; message: string }[] = [];
    try {
      const results = await Promise.allSettled(
        dirtyKeys.map(async (key) => {
          const res = await fetch(`/api/proxy/v1/admin/tenant/modules/${encodeURIComponent(key)}/toggle`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: pending[key], ...(reason ? { reason } : {}) }),
          });
          if (!res.ok) {
            const msg = (await formError.fromResponse(res, "save")).message;
            throw new Error(msg);
          }
          return key;
        }),
      );
      results.forEach((r, i) => {
        const key = dirtyKeys[i];
        if (r.status === "fulfilled") succeeded.push(key);
        else failed.push({ key, message: formError.fromException("save", r.reason).message });
      });

      if (failed.length === 0) {
        setStatus(`Saved ${succeeded.length} module${succeeded.length === 1 ? "" : "s"}.`);
      } else {
        const failNames = failed.map((f) => nameFor[f.key] ?? f.key).join(", ");
        setStatus(`Saved ${succeeded.length} of ${dirtyKeys.length}.`);
        setError(`${failNames} failed: ${failed[0].message}`);
      }
      setConfirmOpen(false);
      // Always refresh so the UI reflects whichever toggles actually persisted
      // (GAP-TENANT-ADMIN-SETTINGS-03) rather than keeping a stale local view.
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>Module toggles</h3>
        <Button disabled={busy || !dirty} aria-busy={busy} onClick={() => { setError(""); setStatus(""); setConfirmOpen(true); }}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
      <div className="pad">
        {modules.length > 0 ? (
          modules.map((mod) => {
            const on = pending[mod.moduleKey];
            return (
              <div key={mod.moduleKey} className="prefrow">
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{mod.moduleName}</div>
                  <div style={{ fontSize: 12, color: "var(--mut)" }}><span className="mono">{mod.moduleKey}</span></div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: on ? "#067647" : "var(--mut)", minWidth: 56, textAlign: "right" }}>
                    {on ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${mod.moduleName} module: ${on ? "enabled" : "disabled"}`}
                    disabled={busy}
                    onClick={() => toggle(mod.moduleKey)}
                    className="switch"
                    style={{
                      position: "relative", width: 40, height: 22, borderRadius: 11,
                      border: "1px solid var(--line)", background: on ? "#12b76a" : "#e4e7ec",
                      cursor: busy ? "default" : "pointer", transition: "background .15s", padding: 0,
                    }}
                  >
                    <span aria-hidden="true" style={{
                      position: "absolute", top: 2, left: on ? 20 : 2, width: 16, height: 16,
                      borderRadius: "50%", background: "#fff", transition: "left .15s",
                      boxShadow: "0 1px 2px rgba(0,0,0,.2)",
                    }} />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState icon="🧩" title="No modules" message="Modules will appear here once configured." />
        )}
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", marginTop: 8 }}>{status}</div>
        <div role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{error}</div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Apply module changes?"
        description={
          <div style={{ display: "grid", gap: 8 }}>
            {beingEnabled.length > 0 ? <div><b>Enabling:</b> {beingEnabled.map((k) => nameFor[k] ?? k).join(", ")}</div> : null}
            {beingDisabled.length > 0 ? (
              <div style={{ color: "var(--bad)" }}>
                <b>Disabling:</b> {beingDisabled.map((k) => nameFor[k] ?? k).join(", ")}
                <div style={{ fontSize: 12, marginTop: 4 }}>Disabling a module removes it for every user in this tenant.</div>
              </div>
            ) : null}
          </div>
        }
        confirmLabel="Apply changes"
        danger={anyDisable}
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={(reason) => void save(reason)}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setError(""); } }}
      />
    </div>
  );
}

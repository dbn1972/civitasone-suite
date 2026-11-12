"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, EmptyState } from "../../../_components/ds";

export type CatalogueModule = {
  id: string;
  name: string;
  cluster: string;
  enabled: boolean;
  source: "user" | "dep" | "core" | null;
  hardDeps: string[];
  softDeps: string[];
  requiredBy: string[];
};

/**
 * Module settings when the module catalogue is the single source (admin-service MODULE_SOURCE=catalogue, M4).
 * The older per-key toggle is retired in that mode, so this page talks to the catalogue endpoints
 * (POST /v1/admin/composition/modules/:id/enable|disable) and shows what the catalogue knows:
 *   - what enabling a module will ALSO enable (its hard dependencies, pulled in automatically);
 *   - which modules are on only because another module needs them (included automatically, cannot be switched off alone);
 *   - which modules need this one (so it cannot be disabled), and soft "used when present" links.
 * Each switch is a real <button role="switch"> with a text state beside it; a change is confirmed in a dialog that
 * lists the consequences, and the outcome is announced in a polite live region (errors in an alert region).
 */
export function CatalogueModuleSettings({ modules }: { modules: CatalogueModule[] }) {
  const t = useTranslations("tenantModuleCatalogue");
  const router = useRouter();
  const [target, setTarget] = useState<{ id: string; enable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const byId = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);
  const name = (id: string): string => byId.get(id)?.name ?? id;
  const names = (ids: string[]): string => ids.map(name).join(", ");

  /** Hard dependencies (transitive) of `id` that are not yet enabled: what enabling `id` will also switch on. */
  function alsoEnabled(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    const stack = [...(byId.get(id)?.hardDeps ?? [])];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      const m = byId.get(d);
      if (!m) continue;
      if (!m.enabled) out.push(d);
      stack.push(...m.hardDeps);
    }
    return out.sort();
  }

  async function apply(): Promise<void> {
    if (!target) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/composition/modules/${encodeURIComponent(target.id)}/${target.enable ? "enable" : "disable"}`, { method: "POST" });
      if (!res.ok) {
        setError(res.status === 409 ? t("blocked", { module: name(target.id) }) : t("saveFailed"));
        return;
      }
      setStatus(t(target.enable ? "savedEnabled" : "savedDisabled", { module: name(target.id) }));
      setTarget(null);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const tm = target ? byId.get(target.id) : undefined;
  const extra = target?.enable ? alsoEnabled(target.id) : [];

  return (
    <div className="card" id="catalogue-modules">
      <div className="card-h">
        <h3>{t("title")}</h3>
      </div>
      <div className="pad">
        <p style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 0 }}>{t("lead")}</p>
        {modules.length === 0 ? (
          <EmptyState icon="🧩" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          modules.map((m) => {
            const lockedByOthers = m.enabled && m.requiredBy.length > 0;
            const auto = m.enabled && m.source === "dep";
            const locked = lockedByOthers || auto;
            const state = m.enabled ? (auto ? t("stateAuto") : t("stateEnabled")) : t("stateDisabled");
            const hintId = `cm-hint-${m.id}`;
            return (
              <div key={m.id} className="prefrow" data-testid={`catalogue-row-${m.id}`}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: "var(--mut)" }}><span className="mono">{m.id}</span></div>
                  <div id={hintId} style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>
                    {m.hardDeps.length > 0 ? <div>{t("requires", { modules: names(m.hardDeps) })}</div> : null}
                    {m.softDeps.length > 0 ? <div>{t("usesWhenPresent", { modules: names(m.softDeps) })}</div> : null}
                    {lockedByOthers ? <div>{t("neededBy", { modules: names(m.requiredBy) })}</div> : null}
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: m.enabled ? "var(--good)" : "var(--mut)", minWidth: 56, textAlign: "end" }}>{state}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.enabled}
                    aria-label={t("switchLabel", { module: m.name, state })}
                    aria-describedby={hintId}
                    disabled={busy || locked}
                    onClick={() => { setStatus(""); setError(""); setTarget({ id: m.id, enable: !m.enabled }); }}
                    className="switch"
                    style={{
                      position: "relative", width: 40, height: 22, borderRadius: 11,
                      border: "1px solid var(--line)", background: m.enabled ? "#12b76a" : "var(--line)",
                      cursor: busy || locked ? "default" : "pointer", opacity: locked ? 0.6 : 1, transition: "background .15s", padding: 0,
                    }}
                  >
                    <span aria-hidden="true" style={{
                      position: "absolute", top: 2, left: m.enabled ? 20 : 2, width: 16, height: 16,
                      borderRadius: "50%", background: "var(--panel)", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)",
                    }} />
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--good)", marginTop: 8 }}>{status}</div>
        <div role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{error}</div>
      </div>

      <ConfirmDialog
        open={target !== null}
        title={target?.enable ? t("confirmEnableTitle", { module: tm?.name ?? "" }) : t("confirmDisableTitle", { module: tm?.name ?? "" })}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            {target?.enable ? (
              extra.length > 0 ? <div>{t("alsoEnabled", { modules: names(extra) })}</div> : <div>{t("noExtra")}</div>
            ) : (
              <div>{t("disableBody")}</div>
            )}
          </div>
        }
        confirmLabel={t("apply")}
        cancelLabel={t("cancel")}
        danger={target ? !target.enable : false}
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={() => void apply()}
        onCancel={() => { if (!busy) { setTarget(null); setError(""); } }}
      />
    </div>
  );
}

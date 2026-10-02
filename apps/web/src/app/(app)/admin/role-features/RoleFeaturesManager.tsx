"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Modal, PageHeader, RefreshErrorState, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminRoleSummary, RoleFeatureGrant } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";

// Curated catalogue of selectable feature keys — there is no backend
// registry of "every feature key that could ever exist" to load (the
// role_feature_grants table only ever holds grants someone has actually
// created), so this list is a picklist for the "grant a new feature" form,
// same role a static preset list plays elsewhere in this app (e.g.
// CRON_PRESETS on admin/scheduled-jobs). It is NOT standing in for the
// grants themselves — those come from the real GET /v1/policy/role-features
// below.
const FEATURE_KEYS = [
  "finance.dashboard", "finance.vouchers", "finance.budget", "finance.reports",
  "hrms.employees", "hrms.attendance", "hrms.leave",
  "procurement.requisitions", "procurement.purchase_orders", "procurement.vendors",
  "projects.view", "projects.manage",
  "citizen.services", "citizen.grievances",
  "admin.settings", "admin.users",
];

/**
 * Plain-language failure message for a failed role-feature grant/revoke
 * call. This is a plain async API helper, not a component, so it can't use
 * the useFormError hook; toHumanError is the same catalogued-message
 * building block that hook is built on — never the backend's own `message`
 * or the raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
 * UX-003/UX-016.
 */
function roleFeatureError(): string {
  const human = toHumanError("save", { area: "role feature grant" });
  return `${human.what} ${human.next}`;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; json?: unknown }> {
  try {
    const res = await fetch(`/api/proxy/v1/policy/role-features${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, message: roleFeatureError() };
    return { ok: true, json };
  } catch {
    return { ok: false, message: roleFeatureError() };
  }
}

/** Re-read the real grants (the write path is async, so a 202 body is not the source of truth). */
async function fetchGrants(): Promise<RoleFeatureGrant[] | null> {
  try {
    const res = await fetch("/api/proxy/v1/policy/role-features", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: unknown } | unknown[];
    const rows = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : null;
    if (!rows) return null;
    return rows
      .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
      .map((g) => ({ id: String(g.id ?? ""), roleName: String(g.roleName ?? ""), featureKey: String(g.featureKey ?? ""), granted: g.granted !== false }));
  } catch {
    return null;
  }
}

// What the confirm dialog is currently asking about.
type Pending =
  | { kind: "toggle"; role: string; roleName: string; feature: string; revoke: boolean }
  | { kind: "preset"; role: string; roleName: string; label: string; features: string[] };

export function RoleFeaturesManager({
  roles,
  initialGrants,
  rolesSource,
  grantsSource,
}: {
  roles: AdminRoleSummary[];
  initialGrants: RoleFeatureGrant[];
  rolesSource: "api" | "error";
  grantsSource: "api" | "error";
}) {
  const t = useTranslations("roleFeatures");
  const [grants, setGrants] = useState<RoleFeatureGrant[]>(initialGrants);
  const [selectedRole, setSelectedRole] = useState<string>(roles[0]?.key ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  // GAP-ADMIN-ROLE-FEATURES-06: with the grants unknown the matrix would show
  // every box unticked, and a click would POST over state we cannot see.
  const grantsUnknown = grantsSource === "error";

  const grantByCell = useMemo(() => {
    const m = new Map<string, RoleFeatureGrant>();
    for (const g of grants) if (g.granted) m.set(`${g.roleName}:${g.featureKey}`, g);
    return m;
  }, [grants]);

  function isGranted(role: string, feature: string): boolean {
    return grantByCell.has(`${role}:${feature}`);
  }

  async function resync() {
    const fresh = await fetchGrants();
    if (fresh) setGrants(fresh);
    return fresh;
  }

  async function doToggle(role: string, feature: string) {
    const cellKey = `${role}:${feature}`;
    setBusyKey(cellKey);
    setError(null);
    setNotice(null);
    const existing = grantByCell.get(cellKey);
    if (existing) {
      const result = await callApi(`/${existing.id}`, "DELETE");
      if (!result.ok) {
        setError(result.message ?? t("revokeFailed"));
      } else {
        setGrants((prev) => prev.filter((g) => g.id !== existing.id));
        setNotice(t("noticeRevoked"));
      }
    } else {
      const result = await callApi("", "POST", { roleName: role, featureKey: feature, granted: true });
      if (!result.ok) {
        setError(result.message ?? t("grantFailed"));
      } else {
        const id = (result.json as { id?: string } | undefined)?.id;
        if (id) {
          setGrants((prev) => [...prev, { id, roleName: role, featureKey: feature, granted: true }]);
          setNotice(t("noticeGranted"));
        } else {
          // 202 with no id: never claim "Granted" for a box that stays unticked --
          // re-read the real grants and report what actually landed.
          const fresh = await resync();
          if (fresh?.some((g) => g.granted && g.roleName === role && g.featureKey === feature)) setNotice(t("noticeGranted"));
          else setNotice(t("grantNotConfirmed"));
        }
      }
    }
    setBusyKey(null);
  }

  async function doPreset(role: string, features: string[]) {
    setError(null);
    setNotice(null);
    const todo = features.filter((f) => !isGranted(role, f));
    let granted = 0;
    let missingId = false;
    let failedAt: string | null = null;
    for (const feature of todo) {
      setBusyKey(`${role}:${feature}`);
      const result = await callApi("", "POST", { roleName: role, featureKey: feature, granted: true });
      if (!result.ok) {
        failedAt = feature;
        break;
      }
      const id = (result.json as { id?: string } | undefined)?.id;
      if (id) setGrants((prev) => [...prev, { id, roleName: role, featureKey: feature, granted: true }]);
      else missingId = true;
      granted++;
    }
    setBusyKey(null);
    // Accepted without an id: re-read the real grants so the ticks match the server.
    if (missingId) await resync();
    if (failedAt) {
      // GAP-ADMIN-ROLE-FEATURES-04: no bulk endpoint, so a partial result is possible by
      // design. Say exactly what happened and that nothing was rolled back.
      setError(t("presetPartial", { granted, total: todo.length, feature: failedAt }));
    } else if (granted > 0) {
      setNotice(t("presetOk", { count: granted }));
    }
  }

  function requestToggle(role: AdminRoleSummary, feature: string) {
    setPending({ kind: "toggle", role: role.key, roleName: role.name, feature, revoke: isGranted(role.key, feature) });
  }

  async function confirmPending() {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "toggle") await doToggle(p.role, p.feature);
    else await doPreset(p.role, p.features);
  }

  const roleGrants = grants.filter((g) => g.roleName === selectedRole && g.granted);
  // GAP-ADMIN-ROLE-FEATURES-02: matrix rows are the curated catalogue PLUS any
  // feature key that actually has a grant but is not in the catalogue, so a
  // legacy grant is visible (and revocable) instead of silently counted.
  const catalogue = useMemo(() => new Set(FEATURE_KEYS), []);
  const featureRows = useMemo(() => {
    const orphanKeys = [...new Set(grants.filter((g) => g.granted && !catalogue.has(g.featureKey)).map((g) => g.featureKey))].sort();
    return [...FEATURE_KEYS, ...orphanKeys];
  }, [grants, catalogue]);
  // "Active grants" counts exactly the ticks the matrix can show: granted AND
  // for a role that has a column. Grants for roles outside the list are
  // reported separately rather than inflating the number.
  const roleKeys = useMemo(() => new Set(roles.map((r) => r.key)), [roles]);
  const totalGrants = grants.filter((g) => g.granted && roleKeys.has(g.roleName)).length;
  const grantsForUnlistedRoles = grants.filter((g) => g.granted && !roleKeys.has(g.roleName)).length;

  const presets = useMemo(() => {
    const byPrefix = (prefix: string) => FEATURE_KEYS.filter((f) => f.startsWith(prefix));
    return [
      { label: t("presetFinance"), features: byPrefix("finance.") },
      { label: t("presetHr"), features: byPrefix("hrms.") },
      { label: t("presetProcurement"), features: byPrefix("procurement.") },
    ].filter((p) => p.features.length > 0);
  }, [t]);

  const selectedRoleName = roles.find((r) => r.key === selectedRole)?.name ?? selectedRole;
  const adminKey = (f: string) => f.startsWith("admin.");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/admin" />
      {/* GAP-ADMIN-ROLE-FEATURES-06: name the part that failed, not just "something". */}
      <DataSourceBadge source={rolesSource} message={t("rolesLoadFailed")} />
      {grantsUnknown && (
        <div style={{ marginBottom: 14 }}>
          <RefreshErrorState error={toHumanError("load", { area: t("grantsArea") })} backHref="/admin" />
        </div>
      )}
      {error && (
        <div role="alert" style={{ background: "var(--badbg, #fef2f2)", color: "var(--bad, #b42318)", border: "1px solid var(--badbd, #fecaca)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ background: "var(--infobg, #eff6ff)", color: "var(--info, #1d4ed8)", border: "1px solid var(--infobd, #bfdbfe)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {notice}
        </div>
      )}
      <StatGrid>
        <StatCard icon="👥" iconBg="#eef2ff" label={t("statRoles")} value={roles.length} />
        <StatCard icon="🔑" iconBg="#ecfdf3" label={t("statFeatureKeys")} value={featureRows.length} />
        <StatCard icon="✅" iconBg="#dbeafe" label={t("statActiveGrants")} value={grantsUnknown ? null : totalGrants} />
        <StatCard icon="📋" iconBg="#fef3c7" label={t("statRoleGrants")} value={grantsUnknown ? null : roleGrants.length} />
      </StatGrid>

      {!grantsUnknown && grantsForUnlistedRoles > 0 && (
        <p role="note" style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--mut)" }}>
          {t("unlistedRoleGrants", { count: grantsForUnlistedRoles })}
        </p>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label htmlFor="role-select" style={{ fontWeight: 600 }}>{t("roleLabel")}</label>
            <select id="role-select" className="input" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} style={{ width: 220 }}>
              {roles.length === 0 && <option value="">{t("noRolesAvailable")}</option>}
              {roles.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
            </select>
          </div>
          <Button type="button" onClick={() => setShowPreview(true)} disabled={!selectedRole || grantsUnknown}>{t("preview")}</Button>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("presetsTitle", { role: selectedRole || "…" })}</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {presets.map((preset) => (
              <Button
                key={preset.label}
                size="sm"
                disabled={!selectedRole || busyKey !== null || grantsUnknown}
                onClick={() => setPending({ kind: "preset", role: selectedRole, roleName: selectedRoleName, label: preset.label, features: preset.features })}
                style={{ fontSize: 12 }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12, overflowX: "auto" }} aria-busy={busyKey !== null}>
        <h4 style={{ margin: "0 0 12px" }}>{t("matrixTitle")}</h4>
        {roles.length === 0 ? (
          <p style={{ color: "var(--mut)", fontSize: 13 }}>{t("noRolesDefined")}</p>
        ) : (
          <table className="data-table" role="table" aria-label={t("matrixAria")}>
            <thead>
              <tr>
                <th scope="col" style={{ position: "sticky", insetInlineStart: 0, background: "var(--panel)", zIndex: 1 }}>{t("colFeature")}</th>
                {roles.map((r) => (
                  <th scope="col" key={r.id} style={{ textAlign: "center", fontSize: 11 }}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureRows.map((feature) => (
                <tr key={feature}>
                  <td style={{ position: "sticky", insetInlineStart: 0, background: "var(--panel)", fontFamily: "monospace", fontSize: 12 }}>
                    {feature}
                    {!catalogue.has(feature) && <span className="pill warn" style={{ marginLeft: 8, fontFamily: "inherit" }}>{t("notInCatalogue")}</span>}
                  </td>
                  {roles.map((r) => {
                    const cellKey = `${r.key}:${feature}`;
                    return (
                      <td key={cellKey} style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isGranted(r.key, feature)}
                          disabled={busyKey !== null || grantsUnknown}
                          aria-busy={busyKey === cellKey}
                          onChange={() => requestToggle(r, feature)}
                          aria-label={t("cellAria", { role: r.name, feature })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* GAP-ADMIN-ROLE-FEATURES-03/-04: every grant/revoke and every preset is confirmed first.
          policy-service's grant/revoke commands take no reason (the audit trail records the
          actor and the grant), so none is collected here -- a reason that goes nowhere would
          only look like a record. */}
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "preset"
            ? t("confirmPresetTitle", { label: pending.label, role: pending.roleName })
            : pending
              ? t(pending.revoke ? "confirmRevokeTitle" : "confirmGrantTitle", { feature: pending.feature, role: pending.roleName })
              : ""
        }
        description={
          pending?.kind === "preset"
            ? t("confirmPresetBody", { count: pending.features.filter((f) => !isGranted(pending.role, f)).length })
            : pending
              ? `${t(pending.revoke ? "confirmRevokeBody" : "confirmGrantBody")}${adminKey(pending.feature) ? ` ${t("confirmAdminNote")}` : ""}`
              : undefined
        }
        confirmLabel={pending?.kind === "toggle" && pending.revoke ? t("confirmRevokeAction") : t("confirmGrantAction")}
        cancelLabel={t("cancel")}
        danger={pending?.kind === "toggle" && (pending.revoke || adminKey(pending.feature))}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />

      <Modal open={showPreview} onClose={() => setShowPreview(false)} title={t("previewTitle", { role: selectedRoleName })} size="md">
        <p style={{ color: "var(--mut)", margin: "8px 0 16px" }}>{t("previewIntro")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {roleGrants.length === 0 ? (
            <p style={{ color: "var(--mut)" }}>{t("previewEmpty")}</p>
          ) : (
            roleGrants.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 4, background: "var(--goodbg, #f0fdf4)" }}>
                <span style={{ color: "var(--good, #16a34a)" }} aria-hidden="true">✅</span>
                <span style={{ fontFamily: "monospace", fontSize: 13 }}>{g.featureKey}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ marginTop: 16, textAlign: "end" }}>
          <Button variant="ghost" onClick={() => setShowPreview(false)}>{t("previewClose")}</Button>
        </div>
      </Modal>
    </div>
  );
}

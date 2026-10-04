"use client";
/**
 * GAP-HR-SUCCESSION-05: POST /v1/hrms/succession/critical-roles and
 * /nominees existed with no UI anywhere on this page. Server already
 * enforces HR_ROLES on both routes (the real authority); this component is
 * only rendered by the server page for an HR-role session in the first
 * place (see succession/page.tsx's PermissionDenied gate).
 */
import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, EntityPicker } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

type Department = { id: string; name: string };
type RoleOption = { planId: string; roleRef: string };
type Readiness = "now" | "1yr" | "2yr" | "3yr";

const fieldStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid var(--line, #e2e8f0)",
  fontSize: "0.875rem",
  background: "var(--bg, #fff)",
  color: "var(--ink)",
};

export function CreatePlanForm({ departments, roles }: { departments: Department[]; roles: RoleOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("successionPlanCard");

  const formError = useFormError("succession plan");
  const [roleRef, setRoleRef] = useState("");
  const [deptId, setDeptId] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [roleError, setRoleError] = useState("");

  async function submitRole() {
    if (!roleRef.trim()) {
      setRoleError(t("roleErrorRequired"));
      return;
    }
    setSavingRole(true);
    setRoleError("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/succession/critical-roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleRef: roleRef.trim(), departmentId: deptId || undefined }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      toast.success(t("roleAddedToast"));
      setRoleRef("");
      setDeptId("");
      router.refresh();
    } catch {
      setRoleError(t("roleErrorSave"));
    } finally {
      setSavingRole(false);
    }
  }

  const [nomineeRole, setNomineeRole] = useState("");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Readiness>("1yr");
  const [developmentPlan, setDevelopmentPlan] = useState("");
  const [savingNominee, setSavingNominee] = useState(false);
  const [nomineeError, setNomineeError] = useState("");

  async function submitNominee() {
    if (!nomineeRole) {
      setNomineeError(t("nomineeErrorRole"));
      return;
    }
    if (!employeeId) {
      setNomineeError(t("nomineeErrorEmployee"));
      return;
    }
    setSavingNominee(true);
    setNomineeError("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/succession/nominees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: nomineeRole,
          employeeId,
          readiness,
          developmentPlan: developmentPlan.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      toast.success(t("nomineeAddedToast"));
      setEmployeeId(null);
      setDevelopmentPlan("");
      router.refresh();
    } catch {
      setNomineeError(t("nomineeErrorSave"));
    } finally {
      setSavingNominee(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      <div className="card">
        <div className="card-h">
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{t("addCriticalRoleTitle")}</h3>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("roleNameLabel")}
            <input
              type="text"
              value={roleRef}
              onChange={(e) => setRoleRef(e.target.value)}
              placeholder={t("roleNamePlaceholder")}
              maxLength={128}
              style={fieldStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("departmentLabel")}
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} style={fieldStyle}>
              <option value="">{t("departmentPlaceholder")}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {roleError && (
            <p role="alert" style={{ margin: 0, fontSize: "0.8125rem", color: "var(--bad, #dc2626)" }}>
              {roleError}
            </p>
          )}
          <Button variant="primary" size="sm" onClick={submitRole} disabled={savingRole}>
            {t("addRoleButton")}
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{t("addNomineeTitle")}</h3>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("selectRoleLabel")}
            <select value={nomineeRole} onChange={(e) => setNomineeRole(e.target.value)} style={fieldStyle}>
              <option value="">{t("selectRolePlaceholder")}</option>
              {roles.map((r) => (
                <option key={r.planId} value={r.planId}>
                  {r.roleRef}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("nomineeLabel")}
            {/* GAP-HR-SUCCESSION-05: a searchable employee picker (SF-06),
                not a typed uuid -- see EntityPicker's own doc comment. */}
            <EntityPicker
              value={employeeId}
              onChange={(v) => setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchEmployees}
              resolve={resolveEmployees}
              placeholder={t("nomineePlaceholder")}
              aria-label={t("nomineeLabel")}
            />
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("readinessLabel")}
            <select value={readiness} onChange={(e) => setReadiness(e.target.value as Readiness)} style={fieldStyle}>
              <option value="now">{t("readyNow")}</option>
              <option value="1yr">{t("oneTwoYears")}</option>
              <option value="2yr">{t("oneTwoYears")}</option>
              <option value="3yr">{t("threeFiveYears")}</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {t("developmentPlanLabel")}
            <textarea
              value={developmentPlan}
              onChange={(e) => setDevelopmentPlan(e.target.value)}
              placeholder={t("developmentPlanPlaceholder")}
              maxLength={2000}
              rows={3}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </label>
          {nomineeError && (
            <p role="alert" style={{ margin: 0, fontSize: "0.8125rem", color: "var(--bad, #dc2626)" }}>
              {nomineeError}
            </p>
          )}
          <Button variant="primary" size="sm" onClick={submitNominee} disabled={savingNominee}>
            {t("addNomineeButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}

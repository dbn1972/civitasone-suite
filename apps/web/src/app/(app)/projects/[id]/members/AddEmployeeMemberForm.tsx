"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, EntityPicker, Field } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { useFormError } from "@/lib/useFormError";

const ROLES = ["engineer", "project_officer", "finance_officer", "viewer"] as const;

/**
 * Add an HRMS employee to the project team (S8 G7). The person needs NO login:
 * contract staff can be project members and be costed to the project. A member
 * without a login cannot be the project manager (the manager opens the cost
 * totals, which needs a login), so that role is not offered here.
 */
export function AddEmployeeMemberForm({ projectId }: { projectId: string }) {
  const t = useTranslations("projectStaffCost");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>("engineer");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("project member");
  const pickerId = useId();
  const roleId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) { setStatus("error"); setMessage(t("employeeRequiredError")); return; }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/members`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId, role }),
      });
      if (!res.ok) { setStatus("error"); setMessage((await formError.fromResponse(res, "save")).message); return; }
      setStatus("success");
      setMessage(t("addedMessage"));
      setEmployeeId(null);
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ flex: "1 1 260px" }}>
        <Field label={t("employeeLabel")} id={pickerId}>
          <EntityPicker value={employeeId} onChange={(v) => setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={searchEmployees} resolve={resolveEmployees} minQueryLength={2} placeholder={t("employeePlaceholder")} />
        </Field>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 180px" }}>
        <label className="label" htmlFor={roleId} style={{ fontSize: "0.82rem" }}>{t("roleLabel")}</label>
        <select id={roleId} className="inp" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} style={{ minHeight: 40 }}>
          {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <Button type="submit" variant="primary" disabled={status === "submitting"} style={{ minHeight: 44 }}>
        {status === "submitting" ? t("addingBtn") : t("addBtn")}
      </Button>
      <p style={{ width: "100%", margin: 0, fontSize: "0.85rem", color: "var(--ink2)" }}>{t("noLoginHint")}</p>
      {message && (
        <p role={status === "error" ? "alert" : "status"} aria-live="polite"
          style={{ width: "100%", margin: 0, fontSize: "0.875rem", color: status === "error" ? "var(--bad)" : "var(--good)" }}>{message}</p>
      )}
    </form>
  );
}

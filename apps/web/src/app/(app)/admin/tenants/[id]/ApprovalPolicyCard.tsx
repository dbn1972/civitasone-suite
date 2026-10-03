"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, Select } from "@/app/_components/ds";
import type { TenantApprovalPolicy, TenantLifecycleRequest } from "@/app/_data/loaders";
import { useFormError } from "@/lib/useFormError";
import { APPROVER_ROLE_OPTIONS, checkPolicyForm, knownErrorCode, toggleRole } from "./lifecycleModel";
import { errorCodeOf, fetchPolicy, policyUrl, sendJson } from "./lifecycleApi";

export type ApprovalPolicyCardProps = {
  tenantId: string;
  policy: TenantApprovalPolicy;
  isDefault: boolean;
  pending: TenantLifecycleRequest | null;
  source: "api" | "error";
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Per-tenant approval policy. Editing it only ever creates a request that a second platform administrator must approve. */
export function ApprovalPolicyCard({ tenantId, policy, isDefault, pending, source }: ApprovalPolicyCardProps) {
  const t = useTranslations("tenantLifecycle");
  const router = useRouter();
  const formError = useFormError("approval policy");
  const [form, setForm] = useState<TenantApprovalPolicy>(policy);
  const [formProblem, setFormProblem] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingNow, setPendingNow] = useState<TenantLifecycleRequest | null>(pending);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setForm(policy); setPendingNow(pending); }, [policy, pending]);
  useEffect(() => {
    if (notice) { const id = window.setTimeout(() => noticeRef.current?.focus(), 0); return () => window.clearTimeout(id); }
    return undefined;
  }, [notice]);

  if (source === "error") {
    return (
      <Card title={t("policyTitle")} padding>
        <p role="alert" style={{ margin: 0 }}>{t("policyLoadFailed")}</p>
      </Card>
    );
  }

  const roleLabel = (r: string) => (r === "super_admin" ? t("roleSuperAdmin") : t("rolePlatformAdmin"));
  const locked = pendingNow !== null;

  function review() {
    const check = checkPolicyForm(form, policy);
    if (!check.ok) { setFormProblem(check.error === "roles" ? t("policyRolesRequired") : t("policyNoChange")); return; }
    setFormProblem(undefined);
    setDialogError(undefined);
    setOpen(true);
  }

  async function submit(reason?: string) {
    setBusy(true); setDialogError(undefined);
    const res = await sendJson("PUT", policyUrl(tenantId), { policy: form, reason });
    if (res?.ok) {
      setBusy(false); setOpen(false); setNotice(t("submitted"));
      for (let i = 0; i < 6; i++) {
        await sleep(700);
        const latest = await fetchPolicy(tenantId);
        if (latest?.pendingChange) { setPendingNow(latest.pendingChange); break; }
      }
      router.refresh();
      return;
    }
    if (!res) setDialogError(formError.fromException("save").message);
    else {
      const code = knownErrorCode(await errorCodeOf(res));
      setDialogError(code ? t(`error.${code}` as never) : (await formError.fromResponse(res, "save")).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("policyTitle")} padding>
      <p style={{ margin: "0 0 4px", color: "var(--mut)", fontSize: 13 }}>{t("policyIntro")}</p>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>{isDefault ? t("policyDefault") : t("policyCustom")}</p>
      {locked && <p role="note" style={{ margin: "0 0 12px" }}><span className="pill warn">{t("policyPendingNote")}</span></p>}
      <fieldset disabled={locked || busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.requiresSecondApprover}
            onChange={(e) => setForm({ ...form, requiresSecondApprover: e.target.checked })} />
          {t("requiresSecondApprover")}
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t("approverRolesLabel")}</legend>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {APPROVER_ROLE_OPTIONS.map((r) => (
              <label key={r} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={form.approverRoles.includes(r)}
                  onChange={() => setForm({ ...form, approverRoles: toggleRole(form.approverRoles, r) })} />
                {roleLabel(r)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t("minApprovalsLabel")}>
          <Select value={String(form.minApprovals)} onChange={(e) => setForm({ ...form, minApprovals: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.reasonRequired} onChange={(e) => setForm({ ...form, reasonRequired: e.target.checked })} />
          {t("reasonRequiredLabel")}
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.notifyTenantAdmins} onChange={(e) => setForm({ ...form, notifyTenantAdmins: e.target.checked })} />
          {t("notifyTenantAdminsLabel")}
        </label>
      </fieldset>
      <p style={{ margin: "12px 0", fontSize: 13, color: "var(--mut)" }}>{t("policyChangeNote")}</p>
      {formProblem && <p role="alert" style={{ margin: "0 0 8px", color: "#b42318" }}>{formProblem}</p>}
      <Button variant="secondary" disabled={locked || busy} onClick={review}>{t("policySubmit")}</Button>
      <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" style={{ marginTop: notice ? 12 : 0, outline: "none" }}>{notice}</div>

      <ConfirmDialog
        open={open}
        title={t("policyConfirmTitle")}
        description={<p>{t("policyConfirmBody")}</p>}
        confirmLabel={t("policyConfirm")}
        reasonLabel={t("reasonLabel")}
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        onCancel={() => { if (!busy) { setOpen(false); setDialogError(undefined); formError.clear(); } }}
        onConfirm={(reason) => void submit(reason)}
      />
    </Card>
  );
}

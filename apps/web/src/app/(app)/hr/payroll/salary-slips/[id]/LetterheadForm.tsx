"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import type { Letterhead } from "./letterhead";

type Props = { initial: Letterhead | null };

const FIELD_STYLE = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

/**
 * GAP-PAYROLL-SALARY-SLIPS-DETAIL-02: set the issuing organisation printed on
 * every salary slip (payroll_admin / super_admin only -- the page gates it).
 * Wrong issuer details on a slip are a compliance problem, so saving goes
 * through a confirmation and the server audits the change.
 */
export function LetterheadForm({ initial }: Props) {
  const t = useTranslations("letterheadForm");
  const router = useRouter();
  const [orgName, setOrgName] = useState(initial?.orgName ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [ddoName, setDdoName] = useState(initial?.ddoName ?? "");
  const [ddoCode, setDdoCode] = useState(initial?.ddoCode ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [signatoryTitle, setSignatoryTitle] = useState(initial?.signatoryTitle ?? "");
  const [showSignatureBlock, setShowSignatureBlock] = useState(initial?.showSignatureBlock ?? false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [orgInvalid, setOrgInvalid] = useState(false);
  const orgField = useId();
  const errId = useId();
  const f = useId();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    if (!orgName.trim()) {
      setOrgInvalid(true);
      setError(t("orgRequiredError"));
      document.getElementById(orgField)?.focus();
      return;
    }
    setOrgInvalid(false);
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/letterhead", {
        method: "PUT",
        body: JSON.stringify({
          orgName: orgName.trim(),
          department: department.trim() || null,
          ddoName: ddoName.trim() || null,
          ddoCode: ddoCode.trim() || null,
          address: address.trim() || null,
          signatoryTitle: signatoryTitle.trim() || null,
          showSignatureBlock,
        }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setConfirmOpen(false);
      setMessage(t("savedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const text = (id: string, label: string, value: string, set: (v: string) => void, max: number, required = false) => (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
        {label} {required && <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>}
      </label>
      <input
        id={id}
        value={value}
        maxLength={max}
        onChange={(e) => { set(e.target.value); if (required) setOrgInvalid(false); }}
        aria-required={required || undefined}
        aria-invalid={required && orgInvalid ? true : undefined}
        aria-describedby={required && orgInvalid ? errId : undefined}
        style={FIELD_STYLE}
      />
    </div>
  );

  return (
    <form onSubmit={openConfirm} noValidate className="no-print">
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink2)" }}>{t("help")}</p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {text(orgField, t("orgNameLabel"), orgName, setOrgName, 160, true)}
        {text(`${f}-dept`, t("departmentLabel"), department, setDepartment, 160)}
        {text(`${f}-ddoName`, t("ddoNameLabel"), ddoName, setDdoName, 160)}
        {text(`${f}-ddoCode`, t("ddoCodeLabel"), ddoCode, setDdoCode, 32)}
        {text(`${f}-addr`, t("addressLabel"), address, setAddress, 400)}
        {text(`${f}-sig`, t("signatoryTitleLabel"), signatoryTitle, setSignatoryTitle, 120)}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
        <input type="checkbox" checked={showSignatureBlock} onChange={(e) => setShowSignatureBlock(e.target.checked)} />
        {t("signatureBlockLabel")}
      </label>
      <div style={{ marginTop: 12 }}>
        <Button type="submit" disabled={busy} style={{ minHeight: 44 }}>{t("saveBtn")}</Button>
      </div>
      {error && !confirmOpen && <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>{error}</p>}
      {message && <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 10 }}>{message}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t("confirmDescription", { orgName: orgName.trim() })}
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

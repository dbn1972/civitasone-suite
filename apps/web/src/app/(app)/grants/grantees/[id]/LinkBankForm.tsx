"use client";

/**
 * LinkBankForm — wires POST /v1/grants/beneficiaries/:id/bank (async, 202;
 * services/grant-service/src/modules/beneficiary/routes.ts, role guard
 * grant_officer/grant_admin/super_admin).
 *
 * Privacy (DPDP): the route accepts ONLY the last 4 digits of the account
 * number (linkBankBody.accountNoMasked, exactly 4 chars) plus IFSC and bank name.
 * This form therefore never collects, sends, logs or stores a full account
 * number, and the confirmation echoes only "••••1234".
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function LinkBankForm({ granteeId }: { granteeId: string }) {
  const t = useTranslations("grantsBank");
  const [last4, setLast4] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ last4?: string; ifsc?: string }>({});
  const [linked, setLinked] = useState<string | null>(null);
  const formError = useFormError("grantee bank account");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    formError.clear();
    const next: { last4?: string; ifsc?: string } = {};
    if (!/^\d{4}$/.test(last4)) next.last4 = t("last4Invalid");
    const code = ifsc.trim().toUpperCase();
    if (!IFSC_RE.test(code)) next.ifsc = t("ifscInvalid");
    setErrors(next);
    if (next.last4 || next.ifsc) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/grants/beneficiaries/${granteeId}/bank`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountNoMasked: last4,
          bankIfsc: code,
          ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
        }),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        return;
      }
      setLinked(last4);
      setLast4("");
      setIfsc("");
      setBankName("");
    } catch (caught) {
      formError.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={t("title")} noValidate>
      <p style={{ color: "var(--ink2)", marginTop: 0 }}>{t("intro")}</p>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label={t("last4")} required error={errors.last4 ?? formError.fieldError("accountNoMasked")}>
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label={t("ifsc")} required error={errors.ifsc ?? formError.fieldError("bankIfsc")}>
          <Input
            autoComplete="off"
            maxLength={11}
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value.toUpperCase())}
            placeholder="SBIN0001234"
          />
        </Field>
        <Field label={t("bankName")}>
          <Input value={bankName} maxLength={100} onChange={(e) => setBankName(e.target.value)} placeholder="State Bank of India" />
        </Field>
      </div>
      {formError.message && (
        <p role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>
          {formError.message}
        </p>
      )}
      {linked && (
        <p role="status" style={{ marginBottom: 0 }}>
          {t("submitted", { masked: `••••${linked}` })}
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t("saving") : t("save")}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("readNote")}</p>
    </form>
  );
}

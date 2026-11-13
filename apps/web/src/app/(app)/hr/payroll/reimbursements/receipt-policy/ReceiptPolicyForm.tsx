"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Input, Select } from "../../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString, minorToRupeesInput } from "@/lib/money";
import { reimbursementCategoryKey } from "@/lib/payroll/reimbursementCategories";
import {
  REIMBURSEMENT_CATEGORY_CODES, RECEIPT_MODES, defaultReceiptRule, type ReceiptMode, type ReceiptPolicy,
} from "@civitasone/types";

type Row = { mode: ReceiptMode; threshold: string; selfDecl: string };

/**
 * Receipt rule per reimbursement category (payroll admin / super admin): always,
 * never, or above an amount, plus an optional amount up to which a signed
 * self-declaration may stand in for the receipt. Saving needs a stated reason
 * and is recorded in the audit log by the server.
 */
export function ReceiptPolicyForm({ policy, isDefault }: { policy: ReceiptPolicy | null; isDefault: boolean }) {
  const t = useTranslations("receiptPolicy");
  const tc = useTranslations("createReimbursementForm");
  const router = useRouter();
  const formError = useFormError("receipt policy");
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(
    REIMBURSEMENT_CATEGORY_CODES.map((c) => {
      const rule = policy?.categories[c] ?? defaultReceiptRule(c);
      return [c, {
        mode: rule.mode,
        threshold: minorToRupeesInput(rule.thresholdMinor ?? null),
        selfDecl: minorToRupeesInput(rule.selfDeclarationUpToMinor ?? null),
      }];
    }),
  ));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const label = (c: string) => { const k = reimbursementCategoryKey(c); return k ? tc(k) : c; };
  const set = (c: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [c]: { ...r[c]!, ...patch } }));

  /** Build the body (only categories that differ from the built-in default) or the first problem. */
  function build(): { ok: true; categories: Record<string, unknown> } | { ok: false; error: string } {
    const categories: Record<string, unknown> = {};
    for (const c of REIMBURSEMENT_CATEGORY_CODES) {
      const r = rows[c]!;
      let threshold: number | null = null;
      if (r.mode === "above_amount") {
        const m = rupeesToMinorString(r.threshold);
        if (m === null || BigInt(m) > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: t("errorThreshold", { category: label(c) }) };
        threshold = Number(m);
      }
      let selfDecl: number | null = null;
      if (r.mode !== "never" && r.selfDecl.trim() !== "") {
        const m = rupeesToMinorString(r.selfDecl);
        if (m === null || BigInt(m) > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: t("errorSelfDecl", { category: label(c) }) };
        selfDecl = Number(m);
        if (threshold !== null && selfDecl <= threshold) return { ok: false, error: t("errorSelfDeclBelowThreshold", { category: label(c) }) };
      }
      const dflt = defaultReceiptRule(c);
      if (r.mode === dflt.mode && threshold === null && selfDecl === null) continue;
      categories[c] = {
        mode: r.mode,
        ...(threshold !== null ? { thresholdMinor: threshold } : {}),
        ...(selfDecl !== null ? { selfDeclarationUpToMinor: selfDecl } : {}),
      };
    }
    return { ok: true, categories };
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const built = build();
    if (!built.ok) { setError(built.error); return; }
    setConfirmOpen(true);
  }

  async function save(reason: string) {
    const built = build();
    if (!built.ok) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/reimbursement-receipt-policy", {
        method: "PUT",
        body: JSON.stringify({ categories: built.categories, reason }),
      });
      if (!res.ok) { setError((await formError.fromResponse(res, "save")).message); return; }
      setConfirmOpen(false);
      setMessage(t("savedMessage"));
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} noValidate>
      <p style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 14px" }}>{isDefault ? t("usingDefaultNote") : t("customNote")}</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <caption style={{ textAlign: "start", fontWeight: 600, paddingBottom: 8 }}>{t("tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "start", padding: "6px 8px" }}>{t("colCategory")}</th>
              <th scope="col" style={{ textAlign: "start", padding: "6px 8px" }}>{t("colRule")}</th>
              <th scope="col" style={{ textAlign: "start", padding: "6px 8px" }}>{t("colThreshold")}</th>
              <th scope="col" style={{ textAlign: "start", padding: "6px 8px" }}>{t("colSelfDecl")}</th>
            </tr>
          </thead>
          <tbody>
            {REIMBURSEMENT_CATEGORY_CODES.map((c) => {
              const r = rows[c]!;
              return (
                <tr key={c} style={{ borderTop: "1px solid var(--line)" }}>
                  <th scope="row" style={{ textAlign: "start", padding: "8px", fontWeight: 600 }}>{label(c)}</th>
                  <td style={{ padding: "8px" }}>
                    <Select
                      aria-label={t("ruleAria", { category: label(c) })}
                      value={r.mode}
                      onChange={(e) => {
                        const mode = e.target.value as ReceiptMode;
                        set(c, { mode, ...(mode !== "above_amount" ? { threshold: "" } : {}), ...(mode === "never" ? { selfDecl: "" } : {}) });
                      }}
                    >
                      {RECEIPT_MODES.map((m) => <option key={m} value={m}>{t(`mode_${m}`)}</option>)}
                    </Select>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <Input
                      aria-label={t("thresholdAria", { category: label(c) })}
                      inputMode="decimal"
                      value={r.threshold}
                      disabled={r.mode !== "above_amount"}
                      onChange={(e) => set(c, { threshold: e.target.value })}
                    />
                  </td>
                  <td style={{ padding: "8px" }}>
                    <Input
                      aria-label={t("selfDeclAria", { category: label(c) })}
                      inputMode="decimal"
                      value={r.selfDecl}
                      disabled={r.mode === "never"}
                      placeholder={t("selfDeclPlaceholder")}
                      onChange={(e) => set(c, { selfDecl: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "10px 0 0" }}>{t("helpText")}</p>

      <div style={{ marginTop: 14 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>{t("saveBtn")}</Button>
      </div>
      {error && !confirmOpen && (
        <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content", maxWidth: "100%" }}>{error}</p>
      )}
      {message && (
        <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t("confirmDescription")}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("confirmReasonLabel")}
        onConfirm={(reason) => void save(reason ?? "")}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

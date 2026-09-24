"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type ReimbursementResponse = {
  data: { id: string; category: string; amount_minor: number | string; status: string };
};

// UX-017: keys are the stable backend category codes, never translated --
// only used to look up which message key holds the display label.
const CATEGORY_VALUES = ["medical", "travel", "lta", "food", "telephone", "internet", "fuel", "other"] as const;

export function CreateReimbursementForm() {
  const t = useTranslations("createReimbursementForm");
  const CATEGORIES = CATEGORY_VALUES.map((value) => ({
    value,
    label: t(`category${value.charAt(0).toUpperCase()}${value.slice(1)}`),
  }));
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("medical");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [billDate, setBillDate] = useState("");
  const [billRef, setBillRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const empId = useId();
  const catId = useId();
  const amtId = useId();
  const periodId = useId();
  const dateId = useId();
  const refId = useId();
  const errId = useId();
  const empRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const periodRef = useRef<HTMLInputElement>(null);

  const [invalidField, setInvalidField] = useState<"employeeId" | "amount" | "period" | null>(null);
  const empInvalid = tone === "bad" && invalidField === "employeeId";
  const amtInvalid = tone === "bad" && invalidField === "amount";
  const periodInvalid = tone === "bad" && invalidField === "period";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setInvalidField("employeeId");
      setMessage(t("employeeIdRequiredError"));
      empRef.current?.focus();
      return;
    }
    const rupees = parseFloat(amount);
    if (Number.isNaN(rupees) || rupees <= 0) {
      setTone("bad");
      setInvalidField("amount");
      setMessage(t("amountRequiredError"));
      amtRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(period.trim())) {
      setTone("bad");
      setInvalidField("period");
      setMessage(t("periodFormatError"));
      periodRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createReimbursement() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const amountMinor = Math.round(parseFloat(amount) * 100);
      const res = await browserJson<ReimbursementResponse>("v1/payroll/reimbursements", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          category,
          amountMinor,
          billDate: billDate.trim() || undefined,
          billRef: billRef.trim() || undefined,
          period: period.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("submittedMessage", { amount: formatMoney(res.data.amount_minor) }));
      setEmployeeId("");
      setAmount("");
      setBillRef("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empId}
                ref={empRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empInvalid || undefined}
                aria-describedby={empInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={catId} style={{ fontSize: 13, fontWeight: 600 }}>{t("categoryLabel")}</label>
              <select
                id={catId}
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("amountLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-required="true"
                aria-invalid={amtInvalid || undefined}
                aria-describedby={amtInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("periodLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                ref={periodRef}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-08"
                aria-required="true"
                aria-invalid={periodInvalid || undefined}
                aria-describedby={periodInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>{t("billDateLabel")}</label>
              <input
                id={dateId}
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={refId} style={{ fontSize: 13, fontWeight: 600 }}>{t("billRefLabel")}</label>
              <input
                id={refId}
                value={billRef}
                onChange={(e) => setBillRef(e.target.value)}
                maxLength={128}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("submitClaimBtn")}
            </Button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t.rich("confirmDescription", {
          category: CATEGORIES.find((c) => c.value === category)?.label ?? category,
          amount: formatMoney(Math.round((parseFloat(amount) || 0) * 100)),
          employeeId,
          period,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createReimbursement()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

"use client";

/**
 * InstallmentScheduleForm — wires the existing, tested grant-service route
 *   POST /v1/grants/applications/:id/installments   (async, 202)
 * (services/grant-service/src/modules/disbursement/routes.ts) to the approved
 * application page. Body shape = createInstallmentsBody:
 *   { installments: [{ installmentNo, amountMinor, condition?, dueDate? }], currency }
 * Amounts are typed in rupees and converted to paise via string maths (no floats).
 * The total may not exceed the sanctioned amount.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

interface Row {
  amount: string;
  dueDate: string;
  condition: string;
}

const MAX_ROWS = 24;
const emptyRow = (): Row => ({ amount: "", dueDate: "", condition: "" });

export function InstallmentScheduleForm({
  applicationId,
  approvedMinor,
}: {
  applicationId: string;
  /** Sanctioned amount in paise; the schedule total may not exceed it. */
  approvedMinor: number;
}) {
  const t = useTranslations("grantsSchedule");
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [clientError, setClientError] = useState("");
  const [done, setDone] = useState(false);
  const formError = useFormError("grant installment schedule");

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const minors = rows.map((r) => rupeesToMinorString(r.amount));
  const total = minors.reduce<bigint>((s, m) => s + (m ? BigInt(m) : 0n), 0n);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setClientError("");
    formError.clear();
    if (minors.some((m) => m === null)) return setClientError(t("amountInvalid"));
    if (total > BigInt(approvedMinor)) {
      return setClientError(t("overApproved", { approved: formatMoney(approvedMinor), total: formatMoney(total) }));
    }
    const dues = rows.map((r) => r.dueDate).filter(Boolean);
    for (let i = 1; i < dues.length; i++) {
      if (dues[i] < dues[i - 1]) return setClientError(t("datesOrder"));
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/grants/applications/${applicationId}/installments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currency: "INR",
          installments: rows.map((r, i) => ({
            installmentNo: i + 1,
            amountMinor: Number(minors[i]),
            ...(r.dueDate ? { dueDate: r.dueDate } : {}),
            ...(r.condition.trim() ? { condition: r.condition.trim() } : {}),
          })),
        }),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        return;
      }
      setDone(true);
      router.refresh();
    } catch (caught) {
      formError.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" style={{ margin: 0 }}>
        {t("submitted")}
      </p>
    );
  }

  const errorText = clientError || formError.message;

  return (
    <form onSubmit={submit} aria-label={t("title")} noValidate>
      <p style={{ color: "var(--ink2)", marginTop: 0 }}>
        {t("intro", { approved: formatMoney(approvedMinor) })}
      </p>
      {rows.map((r, i) => (
        <fieldset key={i} style={{ border: 0, padding: 0, margin: "0 0 12px", display: "grid", gap: 8 }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t("installmentN", { n: i + 1 })}</legend>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <Field label={t("amount")} required>
              <Input
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                placeholder="2,50,000"
              />
            </Field>
            <Field label={t("dueDate")}>
              <Input type="date" value={r.dueDate} onChange={(e) => update(i, { dueDate: e.target.value })} />
            </Field>
            <Field label={t("condition")}>
              <Input
                value={r.condition}
                maxLength={200}
                onChange={(e) => update(i, { condition: e.target.value })}
                placeholder={t("conditionPlaceholder")}
              />
            </Field>
          </div>
          {rows.length > 1 && (
            <div>
              <Button type="button" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                {t("remove", { n: i + 1 })}
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      <p style={{ margin: "8px 0" }}>
        {t("total")}: <strong>{formatMoney(total)}</strong> / {formatMoney(approvedMinor)}
      </p>
      {errorText && (
        <p role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>
          {errorText}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button type="button" variant="ghost" disabled={busy || rows.length >= MAX_ROWS} onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          {t("addInstallment")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t("saving") : t("save")}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("asyncNote")}</p>
    </form>
  );
}

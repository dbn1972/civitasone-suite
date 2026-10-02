"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * GAP-PAYROLL-STATUTORY-PF-05: ECR is filed after a month closes, so an
 * empty default forced every user to type the (almost always) same
 * previous-month value by hand. previousMonthYYYYMM()/currentMonthYYYYMM()
 * give the default and the input's `max` respectively (the current month's
 * payroll is not finalised yet, so generating its ECR is never valid).
 */
function currentMonthYYYYMM(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthYYYYMM(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

export function EcrGeneratorForm() {
  const t = useTranslations("ecrGeneratorForm");
  const [month, setMonth] = useState(previousMonthYYYYMM);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const monthId = useId();
  const errId = useId();
  const monthRef = useRef<HTMLInputElement>(null);
  const monthInvalid = tone === "bad" && !!message;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!MONTH_RE.test(month)) {
      setTone("bad");
      setMessage(t("monthRequiredError"));
      monthRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function generateEcr() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/statutory/ecr?month=${encodeURIComponent(month)}`);
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ECR_${month.replace("-", "")}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setConfirmOpen(false);
      setTone("good");
      setMessage(t("generatedMessage", { month }));
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
          <div style={{ display: "grid", gap: 6, maxWidth: 220 }}>
            <label htmlFor={monthId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("periodLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={monthId}
              ref={monthRef}
              type="month"
              value={month}
              max={currentMonthYYYYMM()}
              onChange={(e) => setMonth(e.target.value)}
              aria-required="true"
              aria-invalid={monthInvalid || undefined}
              aria-describedby={monthInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("submitBtn")}
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
          strong: (chunks) => <strong>{chunks}</strong>,
          month,
        })}
        onConfirm={() => void generateEcr()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

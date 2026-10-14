"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Field, Input } from "../../../../_components/ds";
import { browserJson, UserFacingError } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";

type CalcComponent = { code: string; name: string; amountMinor: number; isEmployerCost: boolean };
type CalcResult = { ctcMinor: number; grossMinor: number; employerCostMinor: number; components: CalcComponent[] };

export function CtcCalculatorForm() {
  const t = useTranslations("ctcCalculatorForm");
  const tv = useTranslations("hrFormErrors2");
  const [ctc, setCtc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Validation state is tracked apart from request failure: only a rejected input marks the field invalid.
  const [fieldInvalid, setFieldInvalid] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);

  const ctcId = useId();
  const errId = useId();
  const ctcRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldInvalid(false);
    setResult(null);

    // GAP-PAYROLL-CTC-05: strict string -> paise conversion (no float
    // multiply; more than 2 decimals is rejected, not silently rounded).
    const minor = rupeesToMinorString(ctc);
    const ctcMinor = minor === null ? NaN : Number(minor);
    if (minor === null || !Number.isSafeInteger(ctcMinor)) {
      setError(t("ctcRequiredError"));
      setFieldInvalid(true);
      ctcRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await browserJson<CalcResult>("v1/payroll/ctc/calculate", {
        method: "POST",
        body: JSON.stringify({ ctcMinor }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof UserFacingError ? err.message : t("calcFailedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("formTitle")}>
      <form noValidate onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        <Field id={ctcId} label={t("annualCtcLabel")} required error={fieldInvalid ? tv("invalidValue") : undefined} style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <Input
            ref={ctcRef}
            type="number"
            min="0"
            step="0.01"
            value={ctc}
            onChange={(e) => setCtc(e.target.value)}
            placeholder={t("ctcPlaceholder")}
          />
        </Field>

        <div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? t("calculatingBtn") : t("calculateBreakupBtn")}
          </Button>
        </div>

        {error && (
          <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {error}
          </p>
        )}

        {result && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("grossPayLabel")}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatMoney(result.grossMinor)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("employerCostLabel")}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatMoney(result.employerCostMinor)}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="sr-only">{t("breakupCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>{t("colComponent")}</th>
                  <th scope="col" style={{ textAlign: "right", padding: "6px 8px", fontSize: 13 }}>{t("colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {result.components.map((c) => (
                  <tr key={c.code}>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>
                      {c.name}{c.isEmployerCost ? t("employerSuffix") : ""}
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>
                      {formatMoney(c.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </form>
    </Card>
  );
}

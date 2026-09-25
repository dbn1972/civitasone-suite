"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../../_components/ds";

/** Convert INR (rupees) input to paise. */
function toPaise(inr: string): number {
  const n = parseFloat(inr);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/** Convert paise to INR string for display. */
function toInr(paise: number): string {
  if (!paise) return "";
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

export function TaxDeclarationForm() {
  const t = useTranslations("taxDeclarationForm");
  const fy = currentFinancialYear();

  const [regime, setRegime] = useState<"old" | "new">("new");
  const [section80c, setSection80c] = useState("");
  const [section80d, setSection80d] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [rentPaid, setRentPaid] = useState("");
  const [prevEmployerSalary, setPrevEmployerSalary] = useState("");
  const [otherSourcesIncome, setOtherSourcesIncome] = useState("");
  const [perquisites, setPerquisites] = useState("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const formError = useFormError("tax declaration");

  const regimeNewId = useId();
  const regimeOldId = useId();
  const s80cId = useId();
  const s80dId = useId();
  const otherId = useId();
  const rentId = useId();
  const prevSalId = useId();
  const otherIncId = useId();
  const perqId = useId();

  // Fetch existing declaration on load
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(`/api/proxy/v1/payroll/tax-declarations?fy=${fy}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setRegime(data.regime === "old" ? "old" : "new");
            setSection80c(toInr(data.section80c));
            setSection80d(toInr(data.section80d));
            setOtherDeductions(toInr(data.otherDeductions));
            setRentPaid(toInr(data.rentPaidMinor));
            setPrevEmployerSalary(toInr(data.prevEmployerSalaryMinor));
            setOtherSourcesIncome(toInr(data.otherSourcesIncomeMinor));
            setPerquisites(toInr(data.perquisitesMinor));
          }
        } else {
          setLoadFailed(true);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [fy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    try {
      const res = await fetch("/api/proxy/v1/payroll/tax-declarations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fy,
          regime,
          section80c: toPaise(section80c),
          section80d: toPaise(section80d),
          otherDeductions: toPaise(otherDeductions),
          rentPaidMinor: toPaise(rentPaid),
          prevEmployerSalaryMinor: toPaise(prevEmployerSalary) || undefined,
          otherSourcesIncomeMinor: toPaise(otherSourcesIncome) || undefined,
          perquisitesMinor: toPaise(perquisites) || undefined,
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("bad");
        setMessage(resolved.message);
        return;
      }
      setTone("good");
      setMessage(t("savedMessage"));
    } catch {
      setTone("bad");
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="pad" style={{ textAlign: "center", padding: 32 }}>
          {t("loadingText")}
        </div>
      </div>
    );
  }

  return (
    <>
    {loadFailed && (
      <div role="alert" style={{ background: "var(--badbg)", border: "1px solid #f85149",
        borderRadius: 6, padding: "10px 14px", marginBottom: 16,
        color: "var(--bad)", fontSize: 13, lineHeight: 1.4 }}>
        {t("loadFailedWarning")}
      </div>
    )}
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>{t("formHeading", { fy })}</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Regime Selection */}
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("regimeLegend")}</legend>
          <div style={{ display: "flex", gap: 24 }}>
            <label htmlFor={regimeNewId} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                id={regimeNewId}
                type="radio"
                name="regime"
                value="new"
                checked={regime === "new"}
                onChange={() => setRegime("new")}
                style={{ width: 18, height: 18 }}
              />
              {t("newRegimeLabel")}
            </label>
            <label htmlFor={regimeOldId} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                id={regimeOldId}
                type="radio"
                name="regime"
                value="old"
                checked={regime === "old"}
                onChange={() => setRegime("old")}
                style={{ width: 18, height: 18 }}
              />
              {t("oldRegimeLabel")}
            </label>
          </div>
        </fieldset>

        {/* Amount fields */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={s80cId} style={{ fontSize: 13, fontWeight: 600 }}>{t("section80cLabel")}</label>
            <input
              id={s80cId}
              type="number"
              min="0"
              step="1"
              placeholder={t("section80cPlaceholder")}
              value={section80c}
              onChange={(e) => setSection80c(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={s80dId} style={{ fontSize: 13, fontWeight: 600 }}>{t("section80dLabel")}</label>
            <input
              id={s80dId}
              type="number"
              min="0"
              step="1"
              placeholder={t("section80dPlaceholder")}
              value={section80d}
              onChange={(e) => setSection80d(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={otherId} style={{ fontSize: 13, fontWeight: 600 }}>{t("otherDeductionsLabel")}</label>
            <input
              id={otherId}
              type="number"
              min="0"
              step="1"
              placeholder={t("otherDeductionsPlaceholder")}
              value={otherDeductions}
              onChange={(e) => setOtherDeductions(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={rentId} style={{ fontSize: 13, fontWeight: 600 }}>{t("rentPaidLabel")}</label>
            <input
              id={rentId}
              type="number"
              min="0"
              step="1"
              placeholder={t("rentPaidPlaceholder")}
              value={rentPaid}
              onChange={(e) => setRentPaid(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={prevSalId} style={{ fontSize: 13, fontWeight: 600 }}>{t("prevEmployerSalaryLabel")}</label>
            <input
              id={prevSalId}
              type="number"
              min="0"
              step="1"
              placeholder={t("optionalPlaceholder")}
              value={prevEmployerSalary}
              onChange={(e) => setPrevEmployerSalary(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={otherIncId} style={{ fontSize: 13, fontWeight: 600 }}>{t("otherSourcesIncomeLabel")}</label>
            <input
              id={otherIncId}
              type="number"
              min="0"
              step="1"
              placeholder={t("optionalPlaceholder")}
              value={otherSourcesIncome}
              onChange={(e) => setOtherSourcesIncome(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={perqId} style={{ fontSize: 13, fontWeight: 600 }}>{t("perquisitesLabel")}</label>
            <input
              id={perqId}
              type="number"
              min="0"
              step="1"
              placeholder={t("optionalPlaceholder")}
              value={perquisites}
              onChange={(e) => setPerquisites(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>

        <div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? t("submittingBtn") : t("submitBtn")}
          </Button>
        </div>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${tone}`} style={{ width: "fit-content" }}>
            {message}
          </p>
        )}

        <p style={{ fontSize: 12, color: "var(--ink2)" }}>
          {t("footerNote", { fy })}
        </p>
      </div>
    </form>
    </>
  );
}

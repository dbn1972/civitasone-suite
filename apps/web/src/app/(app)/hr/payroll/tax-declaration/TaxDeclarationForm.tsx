"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { Button, ConfirmDialog, StatusPill } from "../../../../_components/ds";

type AmountField =
  | "section80c"
  | "section80d"
  | "otherDeductions"
  | "rentPaid"
  | "prevEmployerSalary"
  | "otherSourcesIncome"
  | "perquisites";

/**
 * Parse a clerk-entered rupees string into a non-negative paise integer.
 * Blank or explicit "0" -> 0 (no value declared). Anything else is delegated
 * to lib/money's rupeesToMinorString (rejects negatives, non-numeric input,
 * and more than 2 fractional digits) so this never repeats the
 * `parseFloat(...) * 100` rounding bug (GAP-PAYROLL-TAX-DECLARATION-04) --
 * null means genuinely invalid, distinct from "no value".
 */
function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "0") return 0;
  const minor = rupeesToMinorString(trimmed);
  return minor === null ? null : Number(minor);
}

/** Format paise as a plain rupees string for a step="0.01" input (never native parseFloat math). */
function formatPaiseForInput(paise: unknown): string {
  const n = typeof paise === "number" ? paise : Number(paise);
  if (!Number.isFinite(n) || n === 0) return "";
  return (n / 100).toFixed(2);
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

  // Existing-declaration metadata from the GET, used only to decide whether a
  // submit replaces a prior filing (and to show its status/filed date) --
  // GAP-PAYROLL-TAX-DECLARATION-05. The API has no deadline/lock/window
  // field at all (payroll-service schema checked directly), so none is shown
  // here -- do not add UI for a field that does not exist.
  const [hasExisting, setHasExisting] = useState(false);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [filedAt, setFiledAt] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Record<AmountField, number> | null>(null);

  const regimeNewId = useId();
  const regimeOldId = useId();
  const s80cId = useId();
  const s80dId = useId();
  const otherId = useId();
  const rentId = useId();
  const prevSalId = useId();
  const otherIncId = useId();
  const perqId = useId();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoadFailed(false);
      try {
        const res = await fetch(`/api/proxy/v1/payroll/tax-declarations?fy=${fy}`, { signal });
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setRegime(data.regime === "old" ? "old" : "new");
            setSection80c(formatPaiseForInput(data.section80c));
            setSection80d(formatPaiseForInput(data.section80d));
            setOtherDeductions(formatPaiseForInput(data.otherDeductions));
            setRentPaid(formatPaiseForInput(data.rentPaidMinor));
            setPrevEmployerSalary(formatPaiseForInput(data.prevEmployerSalaryMinor));
            setOtherSourcesIncome(formatPaiseForInput(data.otherSourcesIncomeMinor));
            setPerquisites(formatPaiseForInput(data.perquisitesMinor));
            setHasExisting(true);
            setExistingStatus(typeof data.status === "string" ? data.status : null);
            setFiledAt(typeof data.createdAt === "string" ? data.createdAt : null);
          } else {
            setHasExisting(false);
            setExistingStatus(null);
            setFiledAt(null);
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
    },
    [fy],
  );

  // Fetch existing declaration on load
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function retryLoad() {
    setLoading(true);
    void load();
  }

  function validateAmounts(): Record<AmountField, number> | null {
    const raw: Record<AmountField, string> = {
      section80c,
      section80d,
      otherDeductions,
      rentPaid,
      prevEmployerSalary,
      otherSourcesIncome,
      perquisites,
    };
    const parsed = {} as Record<AmountField, number>;
    for (const key of Object.keys(raw) as AmountField[]) {
      const value = parseRupeesToPaise(raw[key]);
      if (value === null) return null;
      parsed[key] = value;
    }
    return parsed;
  }

  async function performSubmit(parsed: Record<AmountField, number>) {
    setMessage(null);
    setBusy(true);

    try {
      const res = await fetch("/api/proxy/v1/payroll/tax-declarations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fy,
          regime,
          section80c: parsed.section80c,
          section80d: parsed.section80d,
          otherDeductions: parsed.otherDeductions,
          rentPaidMinor: parsed.rentPaid,
          prevEmployerSalaryMinor: parsed.prevEmployerSalary || undefined,
          otherSourcesIncomeMinor: parsed.otherSourcesIncome || undefined,
          perquisitesMinor: parsed.perquisites || undefined,
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
      setHasExisting(true);
      setExistingStatus("submitted");
    } catch {
      setTone("bad");
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const parsed = validateAmounts();
    if (!parsed) {
      setTone("bad");
      setMessage(t("invalidAmountError"));
      return;
    }

    // GAP-PAYROLL-TAX-DECLARATION-01: a declaration that failed to load must
    // never be silently overwritten with a blank/zeroed form -- the submit
    // button is also disabled below, this is a defense-in-depth guard.
    if (loadFailed) return;

    if (hasExisting) {
      setPendingPayload(parsed);
      setConfirmOpen(true);
      return;
    }
    void performSubmit(parsed);
  }

  function handleConfirmReplace() {
    setConfirmOpen(false);
    if (pendingPayload) void performSubmit(pendingPayload);
    setPendingPayload(null);
  }

  function handleConfirmCancel() {
    setConfirmOpen(false);
    setPendingPayload(null);
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

  const regimeDisablesDeductions = regime === "new";

  return (
    <>
    {loadFailed && (
      <div role="alert" style={{ background: "var(--badbg)", border: "1px solid var(--bad)",
        borderRadius: 6, padding: "10px 14px", marginBottom: 16,
        color: "var(--bad)", fontSize: 13, lineHeight: 1.4 }}>
        <span>{t("loadFailedWarning")}</span>{" "}
        <Button type="button" variant="ghost" onClick={retryLoad} style={{ minHeight: 32 }}>
          {t("retryBtn")}
        </Button>
      </div>
    )}

    {hasExisting && !loadFailed && (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="pad" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {existingStatus && <StatusPill status={existingStatus} />}
          {filedAt && <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("filedOnLabel", { date: formatIndianDate(filedAt) })}</span>}
        </div>
      </div>
    )}

    {/*
      noValidate: min/step below are still useful hints (native spinner
      increments) but must not silently block submission via the browser's
      own validation bubble before handleSubmit's validateAmounts() runs --
      this is the only place an invalid amount is rejected, with a styled,
      aria-live message consistent with every other error on this form.
    */}
    <form onSubmit={handleSubmit} noValidate className="card" style={{ marginBottom: 16 }}>
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
          {regimeDisablesDeductions && (
            <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("regimeHint")}</p>
          )}
        </fieldset>

        {/* Amount fields */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={s80cId} style={{ fontSize: 13, fontWeight: 600 }}>{t("section80cLabel")}</label>
            <input
              id={s80cId}
              type="number"
              min="0"
              step="0.01"
              disabled={regimeDisablesDeductions}
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
              step="0.01"
              disabled={regimeDisablesDeductions}
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
              step="0.01"
              disabled={regimeDisablesDeductions}
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
              step="0.01"
              disabled={regimeDisablesDeductions}
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
              step="0.01"
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
              step="0.01"
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
              step="0.01"
              placeholder={t("optionalPlaceholder")}
              value={perquisites}
              onChange={(e) => setPerquisites(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>

        <div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy || loadFailed}>
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
        <p style={{ fontSize: 12, color: "var(--ink2)" }}>
          {t("proofsNote")}
        </p>
      </div>
    </form>

    <ConfirmDialog
      open={confirmOpen}
      title={t("confirmReplaceTitle")}
      description={t("confirmReplaceDescription", { fy, date: filedAt ? formatIndianDate(filedAt) : "" })}
      confirmLabel={t("confirmReplaceConfirmLabel")}
      cancelLabel={t("confirmReplaceCancelLabel")}
      busy={busy}
      onConfirm={handleConfirmReplace}
      onCancel={handleConfirmCancel}
    />
    </>
  );
}

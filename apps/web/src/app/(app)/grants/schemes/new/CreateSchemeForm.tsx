"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type FormStatus = "idle" | "submitting" | "error";

// GAP-GRANTS-SCHEMES-NEW-05: scheme code format. Uppercase alphanumerics plus
// hyphens, 3–31 chars, matching the grant-service code constraint (max 32).
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,30}$/;

// GAP-GRANTS-SCHEMES-NEW-02: reporting cadence options the grant-service
// compliance monitor understands (Quarterly=90, Half-yearly=180, Annual=365);
// "custom" lets the clerk type an explicit day count.
const REPORTING_OPTIONS = [
  { value: "90", label: "Quarterly (90 days)" },
  { value: "180", label: "Half-yearly (180 days)" },
  { value: "365", label: "Annual (365 days)" },
  { value: "custom", label: "Custom…" },
] as const;

export function CreateSchemeForm() {
  const router = useRouter();

  const [schemeName, setSchemeName] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [sanctionRef, setSanctionRef] = useState("");
  const [totalBudgetRupees, setTotalBudgetRupees] = useState("");
  const [minAmountRupees, setMinAmountRupees] = useState("");
  const [maxAmountRupees, setMaxAmountRupees] = useState("");
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [reportingChoice, setReportingChoice] = useState<string>("90");
  const [reportingCustom, setReportingCustom] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("grant scheme");

  // Live rupee echoes (GAP-GRANTS-SCHEMES-NEW-04): show the parsed amount back
  // so the clerk confirms the figure they typed.
  const budgetMinorStr = rupeesToMinorString(totalBudgetRupees);
  const maxMinorStr = rupeesToMinorString(maxAmountRupees);
  const minMinorStr = minAmountRupees.trim() === "" ? "0" : rupeesToMinorString(minAmountRupees);

  function showError(msg: string) {
    setStatus("error");
    // GAP-GRANTS-SCHEMES-NEW-06: a single message channel — clear any stale
    // server-level error when we set a client-validation message.
    formError.clear();
    setMessage(msg);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!schemeName.trim()) return showError("Scheme name is required.");

    const code = schemeCode.trim().toUpperCase();
    if (!code) return showError("Scheme code is required.");
    if (!CODE_PATTERN.test(code)) {
      return showError(
        "Scheme code must be 3–31 characters: uppercase letters, digits and hyphens only (e.g. PM-KISAN-2024).",
      );
    }

    if (budgetMinorStr === null) {
      return showError("Total budget must be a positive amount in rupees (up to 2 decimals).");
    }
    if (maxMinorStr === null) {
      return showError("Maximum grant per application is required (a positive amount in rupees).");
    }
    if (minMinorStr === null) {
      return showError("Minimum grant must be a valid amount in rupees (up to 2 decimals).");
    }

    const budget = BigInt(budgetMinorStr);
    const minMinor = BigInt(minMinorStr);
    const maxMinor = BigInt(maxMinorStr);
    if (minMinor > maxMinor) {
      return showError("Minimum grant cannot exceed the maximum grant per application.");
    }
    if (maxMinor > budget) {
      return showError("Maximum grant per application cannot exceed the total budget.");
    }

    if (openAt && closeAt && closeAt < openAt) {
      return showError("The closing date must be on or after the opening date.");
    }

    let reportingFrequencyDays: number | undefined;
    if (reportingChoice === "custom") {
      const days = Number(reportingCustom);
      if (!Number.isInteger(days) || days <= 0) {
        return showError("Enter a whole number of days for the custom reporting cycle.");
      }
      reportingFrequencyDays = days;
    } else {
      reportingFrequencyDays = Number(reportingChoice);
    }

    setStatus("submitting");
    setMessage("");
    formError.clear();

    // Only fields the grant-service createSchemeBody accepts. Money is sent as
    // a Number of paise (within safe-integer range for realistic budgets).
    const body: Record<string, unknown> = {
      name: schemeName.trim(),
      code,
      budgetMinor: Number(budget),
      minAmountMinor: Number(minMinor),
      maxAmountMinor: Number(maxMinor),
      reportingFrequencyDays,
    };
    if (sanctionRef.trim()) body.sanctionRef = sanctionRef.trim();
    if (openAt) body.openAt = new Date(`${openAt}T00:00:00.000Z`).toISOString();
    if (closeAt) body.closeAt = new Date(`${closeAt}T00:00:00.000Z`).toISOString();

    try {
      const res = await fetch("/api/proxy/v1/grants/schemes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage("");
        await formError.fromResponse(res, "save");
        return;
      }
      router.push("/grants/schemes");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage("");
      formError.fromException("save", caught);
    }
  }

  // A single error-message line (GAP-GRANTS-SCHEMES-NEW-06): client validation
  // in `message`, server failure in formError.message, never both at once.
  const errorText = message || formError.message || "";

  const panelField: React.CSSProperties = { background: "var(--panel)", padding: "13px 16px" };
  const errorStyle: React.CSSProperties = { fontSize: 12, color: "var(--bad)", marginTop: 4, display: "block" };
  const hintStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink2)", marginTop: 4, display: "block" };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="card pad"
      style={{ maxWidth: 820 }}
      noValidate
    >
      <div className="fields">
        <div className="field" style={panelField}>
          <label className="label" htmlFor="schemeName">
            Scheme Name *
          </label>
          <input
            id="schemeName"
            className="inp"
            value={schemeName}
            onChange={(e) => setSchemeName(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="e.g. PM Kisan Samman Nidhi"
            aria-required="true"
          />
          {formError.fieldError("name") && (
            <span style={errorStyle}>{formError.fieldError("name")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="schemeCode">
            Scheme Code *
          </label>
          <input
            id="schemeCode"
            className="inp"
            value={schemeCode}
            // GAP-GRANTS-SCHEMES-NEW-05: uppercase as the user types so they see
            // the exact value that will be submitted.
            onChange={(e) => setSchemeCode(e.target.value.toUpperCase())}
            required
            style={{ minHeight: 44, textTransform: "uppercase" }}
            placeholder="e.g. PM-KISAN-2024"
            aria-required="true"
            aria-describedby="code-hint"
          />
          <span id="code-hint" style={hintStyle}>
            Uppercase letters, digits and hyphens, 3–31 characters. Must be unique.
          </span>
          {formError.fieldError("code") && (
            <span style={errorStyle}>{formError.fieldError("code")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="sanctionRef">
            Sanction Order Reference
          </label>
          <input
            id="sanctionRef"
            className="inp"
            value={sanctionRef}
            onChange={(e) => setSanctionRef(e.target.value)}
            style={{ minHeight: 44 }}
            placeholder="e.g. F.No.1-2/2026-GRANTS"
          />
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="totalBudgetMinor">
            Total Budget (₹) *
          </label>
          <input
            id="totalBudgetMinor"
            className="inp"
            inputMode="decimal"
            value={totalBudgetRupees}
            onChange={(e) => setTotalBudgetRupees(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="e.g. 500000"
            aria-required="true"
            aria-describedby="budget-hint"
          />
          <span id="budget-hint" style={hintStyle}>
            Enter in rupees (up to 2 decimals).{" "}
            {totalBudgetRupees.trim() !== "" &&
              (budgetMinorStr !== null ? `= ${formatMoney(budgetMinorStr)}` : "Enter a valid amount.")}
          </span>
          {formError.fieldError("budgetMinor") && (
            <span style={errorStyle}>{formError.fieldError("budgetMinor")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="minAmount">
            Minimum Grant per Application (₹)
          </label>
          <input
            id="minAmount"
            className="inp"
            inputMode="decimal"
            value={minAmountRupees}
            onChange={(e) => setMinAmountRupees(e.target.value)}
            style={{ minHeight: 44 }}
            placeholder="Leave blank for no minimum"
            aria-describedby="min-hint"
          />
          <span id="min-hint" style={hintStyle}>
            {minAmountRupees.trim() !== "" &&
              (minMinorStr !== null ? `= ${formatMoney(minMinorStr)}` : "Enter a valid amount.")}
          </span>
          {formError.fieldError("minAmountMinor") && (
            <span style={errorStyle}>{formError.fieldError("minAmountMinor")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="maxAmount">
            Maximum Grant per Application (₹) *
          </label>
          <input
            id="maxAmount"
            className="inp"
            inputMode="decimal"
            value={maxAmountRupees}
            onChange={(e) => setMaxAmountRupees(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="e.g. 100000"
            aria-required="true"
            aria-describedby="max-hint"
          />
          <span id="max-hint" style={hintStyle}>
            Caps a single application. Must be ≤ total budget.{" "}
            {maxAmountRupees.trim() !== "" &&
              (maxMinorStr !== null ? `= ${formatMoney(maxMinorStr)}` : "Enter a valid amount.")}
          </span>
          {formError.fieldError("maxAmountMinor") && (
            <span style={errorStyle}>{formError.fieldError("maxAmountMinor")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="openAt">
            Opens On
          </label>
          <input
            id="openAt"
            className="inp"
            type="date"
            value={openAt}
            onChange={(e) => setOpenAt(e.target.value)}
            style={{ minHeight: 44 }}
          />
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="closeAt">
            Closes On
          </label>
          <input
            id="closeAt"
            className="inp"
            type="date"
            value={closeAt}
            min={openAt || undefined}
            onChange={(e) => setCloseAt(e.target.value)}
            style={{ minHeight: 44 }}
          />
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="reporting">
            Reporting Cycle
          </label>
          <select
            id="reporting"
            className="inp"
            value={reportingChoice}
            onChange={(e) => setReportingChoice(e.target.value)}
            style={{ minHeight: 44 }}
          >
            {REPORTING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {reportingChoice === "custom" && (
            <input
              className="inp"
              type="number"
              min="1"
              step="1"
              value={reportingCustom}
              onChange={(e) => setReportingCustom(e.target.value)}
              style={{ minHeight: 44, marginTop: 8 }}
              placeholder="Days between UC filings, e.g. 120"
              aria-label="Custom reporting cycle in days"
            />
          )}
        </div>
      </div>

      <div role="status" aria-live="polite">
        {errorText ? (
          <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>
            {errorText}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button
          type="submit"
          variant="primary"
          style={{ minHeight: 44 }}
          disabled={status === "submitting"}
          aria-busy={status === "submitting"}
        >
          {status === "submitting" ? "Creating…" : "Create Scheme"}
        </Button>
        <Link href="/grants/schemes" className="btn ghost" style={{ minHeight: 44 }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

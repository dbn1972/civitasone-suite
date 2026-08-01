"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import type { AssetOption } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

/**
 * Custom date validator — NOT native min/max. Requires ISO yyyy-MM-dd, a real
 * calendar date, and (for endDate) strictly after startDate.
 */
function validateDate(value: string): string | null {
  if (!value) return "Enter a date.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a valid date (yyyy-mm-dd).";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Enter a valid calendar date.";
  return null;
}

export function PolicyForm({ assets }: { assets: AssetOption[] }) {
  const router = useRouter();

  const [assetId, setAssetId] = useState("");
  const [policyNo, setPolicyNo] = useState("");
  const [insurer, setInsurer] = useState("");
  const [coverage, setCoverage] = useState("");
  const [premium, setPremium] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const assetSelectId = useId();
  const policyNoId = useId();
  const insurerId = useId();
  const coverageId = useId();
  const premiumId = useId();
  const startDateId = useId();
  const endDateId = useId();
  const summaryId = useId();

  const assetRef = useRef<HTMLSelectElement>(null);
  const policyNoRef = useRef<HTMLInputElement>(null);
  const insurerRef = useRef<HTMLInputElement>(null);
  const coverageRef = useRef<HTMLInputElement>(null);
  const premiumRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);

  const fieldOrder: [string, React.RefObject<HTMLElement>][] = [
    ["assetId", assetRef],
    ["policyNo", policyNoRef],
    ["insurer", insurerRef],
    ["coverage", coverageRef],
    ["premium", premiumRef],
    ["startDate", startDateRef],
    ["endDate", endDateRef],
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const errors: Record<string, string> = {};
    if (!assetId) errors.assetId = "Select the asset this policy covers.";
    if (!policyNo.trim()) errors.policyNo = "Enter the policy number.";
    if (!insurer.trim()) errors.insurer = "Enter the insurer name.";

    const coverageMinor = rupeesToMinorString(coverage);
    if (!coverageMinor) errors.coverage = "Enter a valid sum insured amount (e.g. 500000 or 500000.50).";

    const premiumMinor = rupeesToMinorString(premium);
    if (!premiumMinor) errors.premium = "Enter a valid premium amount (e.g. 12000 or 12000.50).";

    const startErr = validateDate(startDate);
    if (startErr) errors.startDate = startErr;
    const endErr = validateDate(endDate);
    if (endErr) errors.endDate = endErr;
    if (!startErr && !endErr && endDate <= startDate) {
      errors.endDate = "End date must be after the start date.";
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      const firstInvalid = fieldOrder.find(([key]) => errors[key]);
      firstInvalid?.[1].current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await browserJson<AcceptedResponse>("v1/assets/insurance/policies", {
        method: "POST",
        body: JSON.stringify({
          assetId,
          policyNo: policyNo.trim(),
          insurer: insurer.trim(),
          coverageMinor: Number(coverageMinor),
          premiumMinor: Number(premiumMinor),
          currency: "INR",
          startDate,
          endDate,
        }),
      });
      setTone("good");
      setMessage(
        res.id
          ? `Policy submitted (id ${res.id}). It is processed asynchronously and will appear below shortly.`
          : "Policy submitted.",
      );
      setAssetId("");
      setPolicyNo("");
      setInsurer("");
      setCoverage("");
      setPremium("");
      setStartDate("");
      setEndDate("");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 16 }} aria-label="Create an insurance policy">
      <Card title="Create Policy" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={assetSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
              Asset <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <select
              id={assetSelectId}
              ref={assetRef}
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.assetId || undefined}
              aria-describedby={fieldErrors.assetId ? `${assetSelectId}-error` : undefined}
              style={inputStyle}
            >
              <option value="">Select an asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.code, a.name].filter(Boolean).join(" · ") || a.id}
                </option>
              ))}
            </select>
            {fieldErrors.assetId && (
              <p id={`${assetSelectId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.assetId}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={policyNoId} style={{ fontSize: 13, fontWeight: 600 }}>
              Policy Number <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={policyNoId}
              ref={policyNoRef}
              value={policyNo}
              onChange={(e) => setPolicyNo(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.policyNo || undefined}
              aria-describedby={fieldErrors.policyNo ? `${policyNoId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.policyNo && (
              <p id={`${policyNoId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.policyNo}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={insurerId} style={{ fontSize: 13, fontWeight: 600 }}>
              Insurer <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={insurerId}
              ref={insurerRef}
              value={insurer}
              onChange={(e) => setInsurer(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.insurer || undefined}
              aria-describedby={fieldErrors.insurer ? `${insurerId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.insurer && (
              <p id={`${insurerId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.insurer}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={coverageId} style={{ fontSize: 13, fontWeight: 600 }}>
              Sum Insured (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={coverageId}
              ref={coverageRef}
              inputMode="decimal"
              value={coverage}
              onChange={(e) => setCoverage(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.coverage || undefined}
              aria-describedby={fieldErrors.coverage ? `${coverageId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.coverage && (
              <p id={`${coverageId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.coverage}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={premiumId} style={{ fontSize: 13, fontWeight: 600 }}>
              Premium (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={premiumId}
              ref={premiumRef}
              inputMode="decimal"
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.premium || undefined}
              aria-describedby={fieldErrors.premium ? `${premiumId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.premium && (
              <p id={`${premiumId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.premium}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={startDateId} style={{ fontSize: 13, fontWeight: 600 }}>
              Start Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={startDateId}
              ref={startDateRef}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.startDate || undefined}
              aria-describedby={fieldErrors.startDate ? `${startDateId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.startDate && (
              <p id={`${startDateId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.startDate}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={endDateId} style={{ fontSize: 13, fontWeight: 600 }}>
              End Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={endDateId}
              ref={endDateRef}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.endDate || undefined}
              aria-describedby={fieldErrors.endDate ? `${endDateId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.endDate && (
              <p id={`${endDateId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.endDate}
              </p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy} aria-label="Create insurance policy">
            {busy ? "Saving…" : "Create Policy"}
          </button>
        </div>

        {message && (
          <p
            id={summaryId}
            role={tone === "bad" ? "alert" : "status"}
            className={`pill ${tone}`}
            style={{ width: "fit-content", marginTop: 12 }}
          >
            {message}
          </p>
        )}
      </Card>
    </form>
  );
}

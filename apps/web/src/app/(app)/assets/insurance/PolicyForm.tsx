"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog, EntityPicker, Field, useConfirmAction, type EntityOption } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { resolveAssets, searchAssets } from "@/lib/entityAdapters/asset";

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

/**
 * GAP-ASSETS-INSURANCE-07: the policies API takes minor units as JSON numbers
 * (z.number().int()), so a paise string is only sendable exactly while it is a
 * safe integer. Anything larger is rejected in the form instead of being
 * silently rounded by Number().
 */
export function safeMinorNumber(minor: string): number | null {
  const n = Number(minor);
  return Number.isSafeInteger(n) ? n : null;
}

const RENEWAL_MIN_DAYS = 1;
const RENEWAL_MAX_DAYS = 365;

export function PolicyForm({ disabledReason }: { disabledReason?: string }) {
  const router = useRouter();

  const [assetId, setAssetId] = useState("");
  const [policyNo, setPolicyNo] = useState("");
  const [insurer, setInsurer] = useState("");
  const [coverage, setCoverage] = useState("");
  const [premium, setPremium] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [renewalDays, setRenewalDays] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ coverageMinor: string; premiumMinor: string } | null>(null);

  const assetSelectId = useId();
  const policyNoId = useId();
  const insurerId = useId();
  const coverageId = useId();
  const premiumId = useId();
  const startDateId = useId();
  const endDateId = useId();
  const renewalId = useId();
  const summaryId = useId();

  const policyNoRef = useRef<HTMLInputElement>(null);
  const insurerRef = useRef<HTMLInputElement>(null);
  const coverageRef = useRef<HTMLInputElement>(null);
  const premiumRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const renewalRef = useRef<HTMLInputElement>(null);
  // Labels of every option the picker has shown, so the confirm dialog can name the chosen asset.
  const seenAssets = useRef(new Map<string, EntityOption>());

  async function searchAndRemember(query: string, signal: AbortSignal) {
    const found = await searchAssets(query, signal);
    for (const o of found) seenAssets.current.set(o.id, o);
    return found;
  }

  const fieldOrder: [string, { current: HTMLElement | null }][] = [
    ["assetId", { get current() { return document.getElementById(assetSelectId); } }],
    ["policyNo", policyNoRef],
    ["insurer", insurerRef],
    ["coverage", coverageRef],
    ["premium", premiumRef],
    ["startDate", startDateRef],
    ["endDate", endDateRef],
    ["renewal", renewalRef],
  ];

  const assetLabel = seenAssets.current.get(assetId)?.label ?? "the selected asset";

  function submit(e: React.FormEvent) {
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

    // GAP-ASSETS-INSURANCE-06: optional; sent only when entered.
    if (renewalDays.trim() !== "") {
      const n = Number(renewalDays);
      if (!/^\d+$/.test(renewalDays.trim()) || n < RENEWAL_MIN_DAYS || n > RENEWAL_MAX_DAYS) {
        errors.renewal = `Enter a whole number of days between ${RENEWAL_MIN_DAYS} and ${RENEWAL_MAX_DAYS}.`;
      }
    }

    // GAP-ASSETS-INSURANCE-07: exact-or-reject, never a silently rounded amount.
    if (coverageMinor && safeMinorNumber(coverageMinor) === null) errors.coverage = "That sum insured is too large to submit.";
    if (premiumMinor && safeMinorNumber(premiumMinor) === null) errors.premium = "That premium is too large to submit.";

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      const firstInvalid = fieldOrder.find(([key]) => errors[key]);
      firstInvalid?.[1].current?.focus();
      return;
    }

    // GAP-ASSETS-INSURANCE-01: money-bearing create -- confirm first. The
    // dialog shows the exact minor-unit strings that will be sent.
    setPending({ coverageMinor: coverageMinor!, premiumMinor: premiumMinor! });
    create.trigger();
  }

  const create = useConfirmAction({
    onConfirm: async () => {
      if (!pending) throw new Error("Complete the form first.");
      setBusy(true);
      try {
        await createPolicy(pending);
      } finally {
        setBusy(false);
      }
    },
  });

  async function createPolicy({ coverageMinor, premiumMinor }: { coverageMinor: string; premiumMinor: string }) {
      await browserJson<AcceptedResponse>("v1/assets/insurance/policies", {
        method: "POST",
        body: JSON.stringify({
          assetId,
          policyNo: policyNo.trim(),
          insurer: insurer.trim(),
          coverageMinor: safeMinorNumber(coverageMinor),
          premiumMinor: safeMinorNumber(premiumMinor),
          currency: "INR",
          startDate,
          endDate,
          ...(renewalDays.trim() !== "" ? { renewalReminderDays: Number(renewalDays) } : {}),
        }),
      });
      setTone("good");
      setMessage(`Policy ${policyNo.trim()} submitted for ${assetLabel}. It will appear in the list shortly.`);
      setPending(null);
      setAssetId("");
      setPolicyNo("");
      setInsurer("");
      setCoverage("");
      setPremium("");
      setStartDate("");
      setEndDate("");
      setRenewalDays("");
      setFieldErrors({});
      router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate style={{ marginBottom: 16 }} aria-label="Create an insurance policy">
      <Card title="Create Policy" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field id={assetSelectId} label="Asset" required error={fieldErrors.assetId} disabled={!!disabledReason}>
            <EntityPicker
              value={assetId || null}
              onChange={(v) => setAssetId(typeof v === "string" ? v : "")}
              search={searchAndRemember}
              resolve={resolveAssets}
              placeholder="Search by asset code or name…"
              noResultsText="No matching asset"
            />
          </Field>

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

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={renewalId} style={{ fontSize: 13, fontWeight: 600 }}>
              Renewal reminder (days before expiry)
            </label>
            <input
              id={renewalId}
              ref={renewalRef}
              inputMode="numeric"
              placeholder="30"
              value={renewalDays}
              onChange={(e) => setRenewalDays(e.target.value)}
              aria-invalid={!!fieldErrors.renewal || undefined}
              aria-describedby={fieldErrors.renewal ? `${renewalId}-error` : undefined}
              style={inputStyle}
            />
            {fieldErrors.renewal && (
              <p id={`${renewalId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.renewal}
              </p>
            )}
          </div>
        </div>

        {disabledReason ? (
          <p role="alert" style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {disabledReason}
          </p>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy || !!disabledReason} aria-label="Create insurance policy">
            {busy ? "Saving…" : "Create Policy"}
          </Button>
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
      <ConfirmDialog
        open={create.open}
        title="Create this insurance policy?"
        description={
          pending ? (
            <>
              Policy <b>{policyNo.trim()}</b> with <b>{insurer.trim()}</b> for <b>{assetLabel}</b>: sum insured{" "}
              <b>{formatMoney(pending.coverageMinor)}</b>, premium <b>{formatMoney(pending.premiumMinor)}</b>, cover{" "}
              {formatIndianDate(startDate)} to {formatIndianDate(endDate)}.
            </>
          ) : null
        }
        confirmLabel="Create policy"
        busy={create.busy}
        errorMessage={create.error}
        onConfirm={create.confirm}
        onCancel={() => { create.cancel(); setPending(null); }}
      />
    </form>
  );
}

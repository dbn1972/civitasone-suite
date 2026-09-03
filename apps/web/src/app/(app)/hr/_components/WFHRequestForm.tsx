/**
 * WFHRequestForm — submits a Work-From-Home request.
 * DoPT OM 2022 / DoPT WFH policy: max 2 days/week for non-gazetted staff (Level 1–10).
 * WCAG 2.2 AA: all form fields labelled, error states, 44px touch targets.
 */
"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";

interface WFHRequestFormProps {
  /** Pre-fill employee UUID (optional — admin filing on behalf) */
  employeeId?: string;
  /**
   * Pay Level from the employee record (GoI pay matrix Level 1–18).
   * Non-gazetted: Level 1–10; Gazetted: Level 11–18.
   * Pass undefined when not yet known — form warns but allows submission.
   */
  payLevel?: number;
  /**
   * WFH days already approved/taken in the current ISO week.
   * DoPT OM 2022 cap: 2 days/week for eligible staff.
   */
  weeklyWfhCount?: number;
}

type SubmitState = "idle" | "submitting" | "done" | "error";

export function WFHRequestForm({
  employeeId: prefillId = "",
  payLevel,
  weeklyWfhCount,
}: WFHRequestFormProps) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [employeeId, setEmployeeId] = useState(prefillId);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const idEmp = useId();
  const idFrom = useId();
  const idTo = useId();
  const idReason = useId();
  const errId = useId();

  // DoPT OM 2022 eligibility gates
  const isGazetted = payLevel !== undefined && payLevel > 10;
  const weeklyCapReached = weeklyWfhCount !== undefined && weeklyWfhCount >= 2;
  const payLevelUnknown = payLevel === undefined;

  const submitDisabled = isGazetted || weeklyCapReached || state === "submitting";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isGazetted || weeklyCapReached) return; // belt-and-suspenders
    if (!fromDate || !toDate) {
      setErrorMsg("Both From date and To date are required.");
      setState("error");
      return;
    }
    if (toDate < fromDate) {
      setErrorMsg("To date cannot be before From date.");
      setState("error");
      return;
    }
    setState("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/wfh-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, fromDate, toDate, reason: reason || undefined }),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) {
        setErrorMsg(data.message ?? `Server error ${res.status}`);
        setState("error");
        return;
      }
      setState("done");
      setTimeout(() => router.push("/hr/workforce/wfh"), 900);
    } catch {
      setErrorMsg("Network error — please retry.");
      setState("error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Work From Home request form"
      style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 24px" }}
    >
      {/* DoPT OM 2022 eligibility banners */}

      {isGazetted && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="gazetted-error"
          style={errorBannerStyle}
        >
          WFH is available for non-gazetted staff (Level 1–10) only per DoPT OM 2022.
        </div>
      )}

      {weeklyCapReached && !isGazetted && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="weekly-cap-error"
          style={errorBannerStyle}
        >
          2-day weekly WFH limit reached (DoPT OM 2022).
        </div>
      )}

      {payLevelUnknown && !isGazetted && !weeklyCapReached && (
        <div
          role="note"
          data-testid="paylevel-warning"
          style={warningBannerStyle}
        >
          Pay level could not be verified. You may submit, but the request is subject to eligibility review.
        </div>
      )}

      {/* DoPT policy note */}
      <div
        role="note"
        style={{
          background: "var(--info-bg, #eff6ff)",
          border: "1px solid var(--info-border, #bfdbfe)",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 13,
          color: "var(--info-text, #1d4ed8)",
        }}
      >
        Per DoPT O.M., WFH is permitted for eligible cadres up to <strong>2 days per week</strong>.
        Requests beyond this limit require DG/Secretary approval.
      </div>

      {!prefillId && (
        <div>
          <label htmlFor={idEmp} style={labelStyle}>Employee ID (UUID)</label>
          <input
            id={idEmp}
            style={inputStyle}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            pattern="[0-9a-fA-F-]{36}"
            required
            aria-required="true"
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor={idFrom} style={labelStyle}>From Date <span aria-hidden>*</span></label>
          <input
            id={idFrom}
            type="date"
            style={inputStyle}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            required
            aria-required="true"
            min={new Date().toISOString().split("T")[0]}
          />
        </div>
        <div>
          <label htmlFor={idTo} style={labelStyle}>To Date <span aria-hidden>*</span></label>
          <input
            id={idTo}
            type="date"
            style={inputStyle}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
            aria-required="true"
            min={fromDate || new Date().toISOString().split("T")[0]}
          />
        </div>
      </div>

      <div>
        <label htmlFor={idReason} style={labelStyle}>Reason / Purpose</label>
        <textarea
          id={idReason}
          style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Brief reason for the WFH request…"
          maxLength={500}
        />
      </div>

      {(state === "error" || state === "done") && (
        <p
          id={errId}
          role={state === "error" ? "alert" : "status"}
          style={{
            fontSize: 13,
            color: state === "error" ? "var(--red, #dc2626)" : "var(--green, #16a34a)",
            margin: 0,
          }}
        >
          {state === "done" ? "WFH request submitted. Redirecting…" : errorMsg}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn ghost"
          style={{ minHeight: 44 }}
          onClick={() => router.push("/hr/workforce/wfh")}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn primary"
          style={{ minHeight: 44 }}
          disabled={submitDisabled}
          aria-busy={state === "submitting"}
          aria-disabled={submitDisabled}
        >
          {state === "submitting" ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--muted, #6b7280)",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
};

const errorBannerStyle: React.CSSProperties = {
  background: "var(--error-bg, #fef2f2)",
  border: "1px solid var(--error-border, #fecaca)",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--red, #dc2626)",
  fontWeight: 500,
};

const warningBannerStyle: React.CSSProperties = {
  background: "var(--warn-bg, #fffbeb)",
  border: "1px solid var(--warn-border, #fde68a)",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--warn-text, #92400e)",
};

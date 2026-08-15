/**
 * WFHRequestForm — submits a Work-From-Home request.
 * DoPT WFH policy: max 2 days/week for eligible cadres.
 * WCAG 2.2 AA: all form fields labelled, error states, 44px touch targets.
 */
"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";

interface WFHRequestFormProps {
  /** Pre-fill employee UUID (optional — admin filing on behalf) */
  employeeId?: string;
}

type SubmitState = "idle" | "submitting" | "done" | "error";

export function WFHRequestForm({ employeeId: prefillId = "" }: WFHRequestFormProps) {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      aria-label="Work-From-Home request form"
      style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 24px" }}
    >
      {/* DoPT eligibility note */}
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
          style={{ fontSize: 13, color: state === "error" ? "var(--red, #dc2626)" : "var(--green, #16a34a)", margin: 0 }}
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
          disabled={state === "submitting"}
          aria-busy={state === "submitting"}
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

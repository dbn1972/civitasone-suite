/**
 * OvertimeClaimForm — OT claim with supervisor approver field.
 * CCS (Leave) Rules: OT compensation as cash or comp-off.
 * WCAG 2.2 AA: form labels, error states, 44px touch targets.
 */
"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";

type SubmitState = "idle" | "submitting" | "done" | "error";
type CompMode = "cash" | "comp_off";

export function OvertimeClaimForm() {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [requestDate, setRequestDate] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const [compMode, setCompMode] = useState<CompMode>("cash");

  const idEmp = useId();
  const idDate = useId();
  const idHrs = useId();
  const idReason = useId();
  const idApprover = useId();
  const idCash = useId();
  const idCompOff = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (Number(hours) <= 0) {
      setErrorMsg("Hours must be greater than 0.");
      setState("error");
      return;
    }
    setState("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/overtime-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          requestDate,
          hoursRequested: Number(hours),
          reason: reason || undefined,
          dutyOfficerId: approver || undefined,
          compensationMode: compMode,
        }),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) {
        setErrorMsg(data.message ?? `Server error ${res.status}`);
        setState("error");
        return;
      }
      setState("done");
      setTimeout(() => router.push("/hr/workforce/overtime"), 900);
    } catch {
      setErrorMsg("Network error — please retry.");
      setState("error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Overtime claim form"
      style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 24px" }}
    >
      {/* CCS Rules note */}
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
        As per CCS Rules, overtime is compensated as <strong>cash payment</strong> or{" "}
        <strong>compensatory leave (comp-off)</strong>. Duty officer approval is mandatory.
      </div>

      <div>
        <label htmlFor={idEmp} style={labelStyle}>Employee ID (UUID) <span aria-hidden>*</span></label>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor={idDate} style={labelStyle}>Date of Overtime <span aria-hidden>*</span></label>
          <input
            id={idDate}
            type="date"
            style={inputStyle}
            value={requestDate}
            onChange={(e) => setRequestDate(e.target.value)}
            required
            aria-required="true"
          />
        </div>
        <div>
          <label htmlFor={idHrs} style={labelStyle}>Hours Worked OT <span aria-hidden>*</span></label>
          <input
            id={idHrs}
            type="number"
            step="0.5"
            min="0.5"
            max="24"
            style={inputStyle}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 2.5"
            required
            aria-required="true"
          />
        </div>
      </div>

      <div>
        <label htmlFor={idApprover} style={labelStyle}>Duty Officer / Supervisor UUID</label>
        <input
          id={idApprover}
          style={inputStyle}
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
          placeholder="Approving officer's UUID"
          pattern="([0-9a-fA-F-]{36})?"
        />
      </div>

      <fieldset style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, padding: "10px 14px" }}>
        <legend style={{ ...labelStyle, paddingInline: 4 }}>Compensation Mode</legend>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <label htmlFor={idCash} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer", fontSize: 14 }}>
            <input
              id={idCash}
              type="radio"
              name="compMode"
              value="cash"
              checked={compMode === "cash"}
              onChange={() => setCompMode("cash")}
              style={{ width: 18, height: 18 }}
            />
            Cash Payment
          </label>
          <label htmlFor={idCompOff} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer", fontSize: 14 }}>
            <input
              id={idCompOff}
              type="radio"
              name="compMode"
              value="comp_off"
              checked={compMode === "comp_off"}
              onChange={() => setCompMode("comp_off")}
              style={{ width: 18, height: 18 }}
            />
            Compensatory Leave (Comp-off)
          </label>
        </div>
      </fieldset>

      <div>
        <label htmlFor={idReason} style={labelStyle}>Purpose / Nature of Work</label>
        <textarea
          id={idReason}
          style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Brief description of work done during overtime…"
          maxLength={500}
        />
      </div>

      {(state === "error" || state === "done") && (
        <p
          role={state === "error" ? "alert" : "status"}
          style={{ fontSize: 13, color: state === "error" ? "var(--red, #dc2626)" : "var(--green, #16a34a)", margin: 0 }}
        >
          {state === "done" ? "Overtime claim submitted. Redirecting…" : errorMsg}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn ghost"
          style={{ minHeight: 44 }}
          onClick={() => router.push("/hr/workforce/overtime")}
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
          {state === "submitting" ? "Submitting…" : "Submit Claim"}
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

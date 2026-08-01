"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export function LwfConfigForm() {
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [empContrib, setEmpContrib] = useState("");
  const [erContrib, setErContrib] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const stateId = useId();
  const empId = useId();
  const erId = useId();
  const errId = useId();
  const stateRef = useRef<HTMLInputElement>(null);
  const stateInvalid = tone === "bad" && message === "State code is required.";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!stateCode.trim()) {
      setTone("bad");
      setMessage("State code is required.");
      stateRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveLwf() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/state-rules", {
        method: "POST",
        body: JSON.stringify({
          stateCode: stateCode.trim().toUpperCase(),
          lwfEmployee: Math.round((parseFloat(empContrib) || 0) * 100),
          lwfEmployer: Math.round((parseFloat(erContrib) || 0) * 100),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`LWF configuration saved for ${stateCode.trim().toUpperCase()}.`);
      setStateCode(""); setEmpContrib(""); setErContrib("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Add / Update LWF Configuration" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={stateId} style={{ fontSize: 13, fontWeight: 600 }}>
                State Code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={stateId}
                ref={stateRef}
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                maxLength={4}
                placeholder="e.g. KA"
                aria-required="true"
                aria-invalid={stateInvalid || undefined}
                aria-describedby={stateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>Employee Contribution (₹)</label>
              <input
                id={empId}
                type="number" min="0" step="0.01"
                value={empContrib}
                onChange={(e) => setEmpContrib(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={erId} style={{ fontSize: 13, fontWeight: 600 }}>Employer Contribution (₹)</label>
              <input
                id={erId}
                type="number" min="0" step="0.01"
                value={erContrib}
                onChange={(e) => setErContrib(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Save LWF Configuration
            </button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? "assertive" : "polite"}
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
        title="Save this LWF configuration?"
        confirmLabel="Confirm & Save"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Save LWF configuration for <strong>{stateCode.trim().toUpperCase()}</strong>: employee ₹{empContrib || 0},
            employer ₹{erContrib || 0}.
          </>
        }
        onConfirm={() => void saveLwf()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

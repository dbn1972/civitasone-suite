"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const NATURES = [
  "accommodation", "car", "loan", "medical", "club_membership", "gas_electricity_water",
  "domestic_servant", "education", "gift", "other",
] as const;

export function PerquisiteComponentForm({ defaultEmployeeId, defaultFy }: { defaultEmployeeId: string; defaultFy: string }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [fy, setFy] = useState(defaultFy);
  const [nature, setNature] = useState<typeof NATURES[number]>("accommodation");
  const [description, setDescription] = useState("");
  const [valueByEmployer, setValueByEmployer] = useState("");
  const [amountRecovered, setAmountRecovered] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const empIdId = useId();
  const fyId = useId();
  const natureId = useId();
  const descId = useId();
  const valueId = useId();
  const recoveredId = useId();
  const errId = useId();
  const empIdRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const empIdInvalid = tone === "bad" && !!message && message.startsWith("Employee");
  const valueInvalid = tone === "bad" && !!message && message.startsWith("Value by employer");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!employeeId.trim() || !fy.trim()) {
      setTone("bad");
      setMessage("Employee ID and financial year are required.");
      empIdRef.current?.focus();
      return;
    }
    const value = parseFloat(valueByEmployer);
    if (Number.isNaN(value) || value < 0) {
      setTone("bad");
      setMessage("Value by employer must be a valid rupee amount.");
      valueRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveComponent() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/perquisite-components", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          fy: fy.trim(),
          nature,
          description: description.trim() || undefined,
          valueByEmployer: parseFloat(valueByEmployer),
          amountRecovered: amountRecovered.trim() ? parseFloat(amountRecovered) : undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Perquisite component "${nature}" saved for ${employeeId.trim()}.`);
      setDescription(""); setValueByEmployer(""); setAmountRecovered("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Add Perquisite Component" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empIdId} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empIdId}
                ref={empIdRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empIdInvalid || undefined}
                aria-describedby={empIdInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                Financial Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyId}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                placeholder="e.g. 2026-27"
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={natureId} style={{ fontSize: 13, fontWeight: 600 }}>Nature</label>
              <select
                id={natureId}
                value={nature}
                onChange={(e) => setNature(e.target.value as typeof NATURES[number])}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                {NATURES.map((n) => (
                  <option key={n} value={n}>{n.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={descId} style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
              <input
                id={descId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={valueId} style={{ fontSize: 13, fontWeight: 600 }}>
                Value by Employer (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={valueId}
                ref={valueRef}
                type="number" min="0" step="0.01"
                value={valueByEmployer}
                onChange={(e) => setValueByEmployer(e.target.value)}
                aria-required="true"
                aria-invalid={valueInvalid || undefined}
                aria-describedby={valueInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={recoveredId} style={{ fontSize: 13, fontWeight: 600 }}>Amount Recovered (₹)</label>
              <input
                id={recoveredId}
                type="number" min="0" step="0.01"
                value={amountRecovered}
                onChange={(e) => setAmountRecovered(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Save Component
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
        title="Save this perquisite component?"
        confirmLabel="Confirm & Save"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Save perquisite <strong>{nature}</strong> for employee <strong>{employeeId}</strong> (FY {fy}):
            value ₹{valueByEmployer || 0}{amountRecovered ? `, recovered ₹${amountRecovered}` : ""}.
          </>
        }
        onConfirm={() => void saveComponent()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

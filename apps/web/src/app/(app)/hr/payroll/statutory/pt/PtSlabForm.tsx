"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export function PtSlabForm() {
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [slabFrom, setSlabFrom] = useState("0");
  const [slabTo, setSlabTo] = useState("");
  const [ptAmount, setPtAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const stateId = useId();
  const fromId = useId();
  const toId = useId();
  const amtId = useId();
  const errId = useId();
  const stateRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const stateInvalid = tone === "bad" && message === "State code is required.";
  const amtInvalid = tone === "bad" && !!message && message.startsWith("PT amount");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!stateCode.trim()) {
      setTone("bad");
      setMessage("State code is required.");
      stateRef.current?.focus();
      return;
    }
    const amt = parseFloat(ptAmount);
    if (Number.isNaN(amt) || amt < 0) {
      setTone("bad");
      setMessage("PT amount must be a valid rupee amount.");
      amtRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveSlab() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const fromMinor = Math.round((parseFloat(slabFrom) || 0) * 100);
      const toMinor = slabTo.trim() ? Math.round(parseFloat(slabTo) * 100) : 999999999999;
      const taxMinor = Math.round((parseFloat(ptAmount) || 0) * 100);
      await browserJson("v1/payroll/statutory/state-rules", {
        method: "POST",
        body: JSON.stringify({
          stateCode: stateCode.trim().toUpperCase(),
          ptSlabs: [{ fromMinor, toMinor, taxMinor }],
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Professional tax slab saved for ${stateCode.trim().toUpperCase()}.`);
      setStateCode(""); setSlabFrom("0"); setSlabTo(""); setPtAmount("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Add / Update PT Slab" padding>
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
              <label htmlFor={fromId} style={{ fontSize: 13, fontWeight: 600 }}>Slab From (₹)</label>
              <input
                id={fromId}
                type="number" min="0" step="0.01"
                value={slabFrom}
                onChange={(e) => setSlabFrom(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={toId} style={{ fontSize: 13, fontWeight: 600 }}>Slab To (₹, blank = no upper bound)</label>
              <input
                id={toId}
                type="number" min="0" step="0.01"
                value={slabTo}
                onChange={(e) => setSlabTo(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                PT Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number" min="0" step="0.01"
                value={ptAmount}
                onChange={(e) => setPtAmount(e.target.value)}
                aria-required="true"
                aria-invalid={amtInvalid || undefined}
                aria-describedby={amtInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Save PT Slab
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
        title="Save this professional tax slab?"
        confirmLabel="Confirm & Save"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Save PT slab for <strong>{stateCode.trim().toUpperCase()}</strong>: ₹{slabFrom || 0} to{" "}
            {slabTo.trim() ? `₹${slabTo}` : "no upper bound"}, tax ₹{ptAmount || 0}.
          </>
        }
        onConfirm={() => void saveSlab()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type BonusResponse = {
  data: { id: string; bonus_amount_minor: number | string; status: string };
};

export function ComputeBonusForm() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [fy, setFy] = useState("");
  const [basic, setBasic] = useState("");
  const [bonusPct, setBonusPct] = useState("8.33");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const empId = useId();
  const fyId = useId();
  const basicId = useId();
  const pctId = useId();
  const errId = useId();
  const empRef = useRef<HTMLInputElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const basicRef = useRef<HTMLInputElement>(null);

  const empInvalid = tone === "bad" && message === "Employee ID is required.";
  const fyInvalid = tone === "bad" && !!message && message.startsWith("Financial year");
  const basicInvalid = tone === "bad" && !!message && message.startsWith("Basic salary");

  const previewAmountMinor = (() => {
    const b = Math.round(parseFloat(basic) * 100);
    const p = parseFloat(bonusPct);
    if (Number.isNaN(b) || Number.isNaN(p)) return null;
    return Math.round(b * p / 100);
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setMessage("Employee ID is required.");
      empRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(fy.trim())) {
      setTone("bad");
      setMessage("Financial year must be in YYYY-YY format, e.g. 2025-26.");
      fyRef.current?.focus();
      return;
    }
    const rupees = parseFloat(basic);
    if (Number.isNaN(rupees) || rupees <= 0) {
      setTone("bad");
      setMessage("Basic salary must be a positive amount in rupees.");
      basicRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function computeBonus() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const basicMinor = Math.round(parseFloat(basic) * 100);
      const res = await browserJson<BonusResponse>("v1/payroll/bonus/compute", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          fy: fy.trim(),
          basicMinor,
          bonusPct: parseFloat(bonusPct),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Bonus of ${formatMoney(res.data.bonus_amount_minor)} computed.`);
      setEmployeeId("");
      setBasic("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Compute Bonus" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empId}
                ref={empRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empInvalid || undefined}
                aria-describedby={empInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                Financial Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyId}
                ref={fyRef}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                placeholder="2025-26"
                aria-required="true"
                aria-invalid={fyInvalid || undefined}
                aria-describedby={fyInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={basicId} style={{ fontSize: 13, fontWeight: 600 }}>
                Basic Salary (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={basicId}
                ref={basicRef}
                type="number"
                min="0"
                step="0.01"
                value={basic}
                onChange={(e) => setBasic(e.target.value)}
                aria-required="true"
                aria-invalid={basicInvalid || undefined}
                aria-describedby={basicInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={pctId} style={{ fontSize: 13, fontWeight: 600 }}>Bonus % (statutory 8.33–20)</label>
              <input
                id={pctId}
                type="number"
                min="8.33"
                max="20"
                step="0.01"
                value={bonusPct}
                onChange={(e) => setBonusPct(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          {previewAmountMinor !== null && (
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>
              Preview bonus amount: <strong>{formatMoney(previewAmountMinor)}</strong>
            </p>
          )}

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Compute Bonus
            </button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
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
        title="Compute this bonus?"
        confirmLabel="Compute bonus"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Compute a {bonusPct}% bonus on {formatMoney(Math.round((parseFloat(basic) || 0) * 100))} basic for
            employee <strong>{employeeId}</strong>, FY {fy}. This creates a bonus record.
          </>
        }
        onConfirm={() => void computeBonus()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

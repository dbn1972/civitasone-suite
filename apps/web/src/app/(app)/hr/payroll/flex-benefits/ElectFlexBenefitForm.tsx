"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type ElectionLine = { component: string; amount: string };
type ElectionResponse = { data: { id: string; planId: string; fy: string; totalElectedMinor: number } };

const emptyLine = (): ElectionLine => ({ component: "", amount: "" });

export function ElectFlexBenefitForm() {
  const router = useRouter();
  const [planId, setPlanId] = useState("");
  const [fy, setFy] = useState("");
  const [lines, setLines] = useState<ElectionLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const planIdField = useId();
  const fyId = useId();
  const errId = useId();
  const planRef = useRef<HTMLInputElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const lineComponentRefs = useRef<Array<HTMLInputElement | null>>([]);

  const planInvalid = tone === "bad" && message === "Plan ID is required.";
  const fyInvalid = tone === "bad" && !!message && message.startsWith("Financial year");
  const lineGroupInvalid = tone === "bad" && !!message && message.startsWith("Each election line");

  function isLineInvalid(l: ElectionLine): boolean {
    if (!lineGroupInvalid) return false;
    return !l.component.trim() || Number.isNaN(parseFloat(l.amount)) || parseFloat(l.amount) < 0;
  }

  function updateLine(idx: number, patch: Partial<ElectionLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const totalMinor = lines.reduce((sum, l) => {
    const amt = parseFloat(l.amount);
    return sum + (Number.isNaN(amt) ? 0 : Math.round(amt * 100));
  }, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!planId.trim()) {
      setTone("bad");
      setMessage("Plan ID is required.");
      planRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(fy.trim())) {
      setTone("bad");
      setMessage("Financial year must be in YYYY-YY format, e.g. 2025-26.");
      fyRef.current?.focus();
      return;
    }
    const validLines = lines.filter((l) => l.component.trim());
    const firstInvalidIdx = lines.findIndex(
      (l) => !l.component.trim() || Number.isNaN(parseFloat(l.amount)) || parseFloat(l.amount) < 0,
    );
    if (validLines.length === 0 || validLines.some((l) => Number.isNaN(parseFloat(l.amount)) || parseFloat(l.amount) < 0)) {
      setTone("bad");
      setMessage("Each election line needs a component and a non-negative amount.");
      if (firstInvalidIdx >= 0) lineComponentRefs.current[firstInvalidIdx]?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitElection() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<ElectionResponse>("v1/payroll/flex-benefits/elections", {
        method: "POST",
        body: JSON.stringify({
          planId: planId.trim(),
          fy: fy.trim(),
          elections: lines
            .filter((l) => l.component.trim())
            .map((l) => ({ component: l.component.trim(), electedMinor: Math.round(parseFloat(l.amount) * 100) })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Election submitted: ${formatMoney(res.data.totalElectedMinor)} elected.`);
      setPlanId("");
      setLines([emptyLine()]);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Elect Flex Benefit Components" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={planIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                Plan ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={planIdField}
                ref={planRef}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                aria-required="true"
                aria-invalid={planInvalid || undefined}
                aria-describedby={planInvalid ? errId : undefined}
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
          </div>

          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>
              Elections <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </legend>
            <div style={{ display: "grid", gap: 10 }}>
              {lines.map((l, idx) => {
                const compId = `${planIdField}-line-${idx}-comp`;
                const amtId = `${planIdField}-line-${idx}-amt`;
                const rowInvalid = isLineInvalid(l);
                return (
                  <div key={idx} style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr auto", alignItems: "end" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={compId} style={{ fontSize: 12 }}>Component</label>
                      <input
                        id={compId}
                        ref={(el) => { lineComponentRefs.current[idx] = el; }}
                        value={l.component}
                        aria-invalid={rowInvalid || undefined}
                        aria-describedby={rowInvalid ? errId : undefined}
                        onChange={(e) => updateLine(idx, { component: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
                      />
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={amtId} style={{ fontSize: 12 }}>Elected Amount (₹)</label>
                      <input
                        id={amtId}
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.amount}
                        aria-invalid={rowInvalid || undefined}
                        aria-describedby={rowInvalid ? errId : undefined}
                        onChange={(e) => updateLine(idx, { amount: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ minHeight: 40 }}
                      aria-label={`Remove election line ${idx + 1}${l.component ? `: ${l.component}` : ""}`}
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={lines.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ minHeight: 40 }}
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  + Add line
                </button>
              </div>
            </div>
          </fieldset>

          <p style={{ fontSize: 13, color: "var(--ink2)" }}>
            Total elected: <strong>{formatMoney(totalMinor)}</strong>
          </p>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Submit Election
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
        title="Submit this flex benefit election?"
        confirmLabel="Submit election"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Submit election totalling {formatMoney(totalMinor)} for plan <strong>{planId}</strong>, FY {fy}.
          </>
        }
        onConfirm={() => void submitElection()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

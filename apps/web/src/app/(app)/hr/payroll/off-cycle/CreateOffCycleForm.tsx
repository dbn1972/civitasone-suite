"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type RunType = "bonus" | "incentive" | "adhoc";

type ItemDraft = { _key: string; employeeId: string; amountRupees: string };

type CreateResponse = {
  data: { id: string; runType: string; period: string; totalAmountMinor: number; itemCount: number; status: string };
};

function emptyItem(): ItemDraft {
  return { _key: Math.random().toString(36).slice(2), employeeId: "", amountRupees: "" };
}

export function CreateOffCycleForm() {
  const router = useRouter();
  const [runType, setRunType] = useState<RunType>("bonus");
  const [period, setPeriod] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const periodId = useId();
  const descId = useId();
  const runTypeId = useId();
  const errId = useId();
  const periodRef = useRef<HTMLInputElement>(null);
  const empRefs = useRef<(HTMLInputElement | null)[]>([]);

  const periodInvalid = tone === "bad" && !!message && message.startsWith("Period");
  const itemsInvalid = tone === "bad" && !!message && message.startsWith("Every off-cycle item");

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const totalAmountMinor = items.reduce((sum, it) => {
    const rupees = parseFloat(it.amountRupees);
    return sum + (Number.isNaN(rupees) ? 0 : Math.round(rupees * 100));
  }, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!/^\d{4}-\d{2}$/.test(period.trim())) {
      setTone("bad");
      setMessage("Period must be in YYYY-MM format, e.g. 2025-06.");
      periodRef.current?.focus();
      return;
    }
    const allValid = items.every((it) => {
      const rupees = parseFloat(it.amountRupees);
      return it.employeeId.trim().length > 0 && !Number.isNaN(rupees) && rupees > 0;
    });
    if (!allValid) {
      setTone("bad");
      setMessage("Every off-cycle item needs an Employee ID and a positive amount.");
      const firstInvalid = items.findIndex((it) => {
        const rupees = parseFloat(it.amountRupees);
        return !(it.employeeId.trim().length > 0 && !Number.isNaN(rupees) && rupees > 0);
      });
      if (firstInvalid >= 0) empRefs.current[firstInvalid]?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createOffCycle() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<CreateResponse>("v1/payroll/off-cycle", {
        method: "POST",
        body: JSON.stringify({
          runType,
          period: period.trim(),
          description: description.trim() || undefined,
          items: items.map((it) => ({
            employeeId: it.employeeId.trim(),
            amountMinor: Math.round(parseFloat(it.amountRupees) * 100),
          })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        `Off-cycle run created for ${period.trim()} covering ${res.data.itemCount} employee(s), total ${formatMoney(
          res.data.totalAmountMinor,
        )}.`,
      );
      setPeriod("");
      setDescription("");
      setItems([emptyItem()]);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Off-Cycle Run" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={runTypeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Run Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={runTypeId}
                value={runType}
                onChange={(e) => setRunType(e.target.value as RunType)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="bonus">Bonus</option>
                <option value="incentive">Incentive</option>
                <option value="adhoc">Ad-hoc</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                Period <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                ref={periodRef}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2025-06"
                aria-required="true"
                aria-invalid={periodInvalid || undefined}
                aria-describedby={periodInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={descId} style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
              <input
                id={descId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={256}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Items <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </span>
            {items.map((it, index) => {
              const empLabelId = `${errId}-emp-${index}`;
              const amtLabelId = `${errId}-amt-${index}`;
              return (
                <div
                  key={it._key}
                  style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}
                >
                  <div style={{ display: "grid", gap: 6 }}>
                    <label htmlFor={empLabelId} style={{ fontSize: 12, fontWeight: 600 }}>Employee ID</label>
                    <input
                      id={empLabelId}
                      ref={(el) => { empRefs.current[index] = el; }}
                      value={it.employeeId}
                      onChange={(e) => updateItem(index, { employeeId: e.target.value })}
                      aria-required="true"
                      aria-invalid={itemsInvalid && !it.employeeId.trim() ? true : undefined}
                      aria-describedby={itemsInvalid && !it.employeeId.trim() ? errId : undefined}
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label htmlFor={amtLabelId} style={{ fontSize: 12, fontWeight: 600 }}>Amount (₹)</label>
                    <input
                      id={amtLabelId}
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.amountRupees}
                      onChange={(e) => updateItem(index, { amountRupees: e.target.value })}
                      aria-required="true"
                      aria-invalid={itemsInvalid && !(parseFloat(it.amountRupees) > 0) ? true : undefined}
                      aria-describedby={itemsInvalid && !(parseFloat(it.amountRupees) > 0) ? errId : undefined}
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeItem(index)}
                    disabled={items.length === 1}
                    aria-label={`Remove item ${index + 1}`}
                    style={{ minHeight: 44 }}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <div>
              <button type="button" className="btn" onClick={addItem} style={{ minHeight: 44 }}>
                Add Item
              </button>
            </div>
          </div>

          {totalAmountMinor > 0 && (
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>
              Total amount: <strong>{formatMoney(totalAmountMinor)}</strong> across {items.length} employee(s)
            </p>
          )}

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Off-Cycle Run
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
        title="Create this off-cycle run?"
        confirmLabel="Create run"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create a {runType} off-cycle run for period <strong>{period}</strong> covering {items.length} employee(s),
            total {formatMoney(totalAmountMinor)}. This creates the run in draft status; it must be processed
            separately.
          </>
        }
        onConfirm={() => void createOffCycle()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

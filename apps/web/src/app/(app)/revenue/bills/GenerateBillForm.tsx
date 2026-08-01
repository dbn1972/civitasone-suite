"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { DemandRow } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function GenerateBillForm({ assesseeId, demands }: { assesseeId: string; demands: DemandRow[] }) {
  const router = useRouter();
  const [demandId, setDemandId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectId = useId();
  const summaryId = useId();
  const noDemandsHelpId = useId();
  const demandErrorId = `${selectId}-error`;
  const selectRef = useRef<HTMLSelectElement>(null);

  const eligibleDemands = demands.filter((d) => d.status !== "paid");
  const selected = eligibleDemands.find((d) => d.id === demandId);
  const noEligibleDemands = eligibleDemands.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: Record<string, string> = {};
    if (!demandId) errors.demand = "Select a demand to generate a bill for.";
    setFieldErrors(errors);

    if (errors.demand) {
      setTone("bad");
      setMessage("Please correct the highlighted field.");
      selectRef.current?.focus();
      return;
    }

    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function generateBill() {
    if (!selected) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/bills/generate", {
        method: "POST",
        body: JSON.stringify({ assessmentId: selected.assessmentId }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Bill generation submitted (id ${res.id}). It is processed asynchronously and will appear below shortly.`
          : "Bill generation submitted.",
      );
      setDemandId("");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label={`Generate bill for assessee ${assesseeId}`}>
      <Card title="Generate Bill" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
            <label htmlFor={selectId} style={{ fontSize: 13, fontWeight: 600 }}>
              Demand{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                *
              </span>
            </label>
            <select
              id={selectId}
              ref={selectRef}
              value={demandId}
              onChange={(e) => setDemandId(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.demand || undefined}
              aria-describedby={fieldErrors.demand ? demandErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              <option value="">Select a demand…</option>
              {eligibleDemands.map((d) => (
                <option key={d.id} value={d.id}>
                  FY {d.financialYear} — {formatMoney(d.netMinor)} ({d.status})
                </option>
              ))}
            </select>
            {fieldErrors.demand && (
              <p id={demandErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.demand}
              </p>
            )}
          </div>

          <div>
            <button
              type="submit"
              className="btn primary"
              style={{ minHeight: 44 }}
              disabled={busy || noEligibleDemands}
              aria-describedby={noEligibleDemands ? noDemandsHelpId : undefined}
            >
              Generate Bill
            </button>
            {noEligibleDemands && (
              <p id={noDemandsHelpId} style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink2)" }}>
                No outstanding demands for this assessee.
              </p>
            )}
          </div>

          {message && (
            <p
              id={summaryId}
              role={tone === "bad" ? "alert" : "status"}
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
        title="Generate this bill?"
        confirmLabel="Generate bill"
        busy={busy}
        errorMessage={dialogError}
        description={
          selected ? (
            <>
              Generate a bill for demand FY <strong>{selected.financialYear}</strong>, net amount{" "}
              <strong>{formatMoney(selected.netMinor)}</strong>.
            </>
          ) : (
            "Generate this bill?"
          )
        }
        onConfirm={() => void generateBill()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

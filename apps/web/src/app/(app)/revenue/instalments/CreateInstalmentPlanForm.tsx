"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

const MIN_INSTALMENTS = 2;
const MAX_INSTALMENTS = 36;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CreateInstalmentPlanForm({ assesseeId }: { assesseeId: string }) {
  const router = useRouter();
  const [instalmentCount, setInstalmentCount] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const countId = useId();
  const startId = useId();
  const errId = useId();
  const countRef = useRef<HTMLInputElement>(null);

  const parsedCount = Number(instalmentCount);
  const countValid = Number.isInteger(parsedCount) && parsedCount >= MIN_INSTALMENTS && parsedCount <= MAX_INSTALMENTS;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(startDate);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: Record<string, string> = {};
    if (!countValid) {
      errors.count = `Enter a whole number of instalments between ${MIN_INSTALMENTS} and ${MAX_INSTALMENTS}.`;
    }
    if (!dateValid) errors.start = "Enter a valid start date.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.count) countRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createPlan() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/instalments", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          instalmentCount: parsedCount,
          startDate,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Instalment plan submitted (id ${res.id}). It is processed asynchronously and will appear below shortly.`
          : "Instalment plan submitted.",
      );
      setInstalmentCount("");
      setStartDate(todayIso());
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginBottom: 16 }}
      aria-label={`Create instalment plan for assessee ${assesseeId}`}
    >
      <Card title="Create Instalment Plan" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={countId} style={{ fontSize: 13, fontWeight: 600 }}>
                Number of Instalments{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={countId}
                ref={countRef}
                type="number"
                min={MIN_INSTALMENTS}
                max={MAX_INSTALMENTS}
                step={1}
                value={instalmentCount}
                onChange={(e) => setInstalmentCount(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.count || undefined}
                aria-describedby={fieldErrors.count ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={startId} style={{ fontSize: 13, fontWeight: 600 }}>
                Start Date{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={startId}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.start || undefined}
                aria-describedby={fieldErrors.start ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Instalment Plan
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
        title="Create this instalment plan?"
        confirmLabel="Create plan"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create an instalment plan of <strong>{instalmentCount || 0}</strong> instalments starting{" "}
            <strong>{startDate}</strong> for this assessee.
          </>
        }
        onConfirm={() => void createPlan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

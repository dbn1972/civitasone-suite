"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";
import { todayIST } from "@/lib/formatters";
import { periodBounds, suggestPeriod, validatePeriod } from "./periodHelpers";

/**
 * Plain-language fallback for a soft-close network exception (no Response to
 * read). toHumanError is the same catalogued-message building block
 * errorMessageFromResponse (used below for the failed-response path) is
 * built on -- never a raw exception message. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function softCloseExceptionMessage(): string {
  const human = toHumanError("save", { area: "period action" });
  return `${human.what} ${human.next}`;
}

export function ClosePeriodForm({
  periods = [],
  today,
}: {
  /** Tracked periods, used to pre-select the earliest still-open one (GAP-FINANCE-PERIOD-CLOSE-03). */
  periods?: ReadonlyArray<{ period: string; status: string }>;
  /** "YYYY-MM-DD" (IST) override for tests; defaults to today in Asia/Kolkata. */
  today?: string;
}) {
  const router = useRouter();
  const todayIso = today ?? todayIST();
  const bounds = periodBounds(todayIso);

  const [period, setPeriod] = useState(() => suggestPeriod(periods, todayIso));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const periodId = useId();
  const periodErrId = useId();
  const periodRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    // Real month, and not a typo such as 2062-04 (bounded around the current month).
    const problem = validatePeriod(period, todayIso);
    if (problem) {
      setError(problem);
      periodRef.current?.focus();
      return false;
    }
    setError(undefined);
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function softClose(reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      // GAP-FINANCE-PERIOD-CLOSE-01: the stated reason is mandatory and recorded in the audit trail.
      const res = await browserFetch(`v1/finance/periods/${encodeURIComponent(period.trim())}/close`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setDialogError(await errorMessageFromResponse(res, "save", "period action"));
        return;
      }
      setConfirmOpen(false);
      setMessage(`Period ${period.trim()} soft-closed.`);
      setPeriod("");
      router.refresh();
    } catch {
      setDialogError(softCloseExceptionMessage());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title="Soft-Close a Period" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6, maxWidth: 240 }}>
            <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
              Period <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={periodId}
              ref={periodRef}
              type="month"
              value={period}
              min={bounds.min}
              max={bounds.max}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="YYYY-MM"
              aria-required="true"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? periodErrId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {error && (
              <p id={periodErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>
                {error}
              </p>
            )}
          </div>

          <div>
            <Button type="submit" variant="secondary" style={{ minHeight: 44 }} disabled={busy}>
              Soft-Close Period
            </Button>
          </div>

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Soft-close this period?"
        confirmLabel="Soft-close period"
        requireReason
        reasonLabel="Reason for soft-closing"
        minReasonLength={10}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Soft-close period <strong>{period}</strong>. Postings will be flagged for review; this does not block
            postings outright and can be undone by reopening the period afterwards.
          </>
        }
        onConfirm={(reason) => void softClose(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

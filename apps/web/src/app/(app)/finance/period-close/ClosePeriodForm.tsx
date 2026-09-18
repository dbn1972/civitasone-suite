"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";

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

// YYYY-MM with a valid month (01-12).
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function ClosePeriodForm() {
  const router = useRouter();

  const [period, setPeriod] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const periodId = useId();
  const periodErrId = useId();
  const periodRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    if (!PERIOD_PATTERN.test(period.trim())) {
      setError("Period must be a valid month in YYYY-MM format, e.g. 2026-04.");
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

  async function softClose() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/finance/periods/${encodeURIComponent(period.trim())}/close`, {
        method: "POST",
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
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Soft-Close a Period" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6, maxWidth: 240 }}>
            <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
              Period <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={periodId}
              ref={periodRef}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-04"
              maxLength={7}
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
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Soft-close period <strong>{period}</strong>. Postings will be flagged for review; this does not block
            postings outright and can be undone by reopening the period afterwards.
          </>
        }
        onConfirm={() => void softClose()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

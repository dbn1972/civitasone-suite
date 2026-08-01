"use client";

/**
 * Impairment + revaluation — irreversible, GL-posting fixed-asset accounting
 * actions. Verified against services/asset-service/src/modules/enterprise/routes.ts:
 *   POST /v1/assets/assets/:id/impairment   { amountMinor: int>0, reason?, eventDate? }
 *   POST /v1/assets/assets/:id/revaluation  { newBookValueMinor: int>0, reason? }
 * Both post a StandardJournal to finance (impairment -> P&L loss a/c 5200;
 * revaluation -> Revaluation Reserve 3100, direction inferred server-side from
 * old vs new book value). All money fields are minor units (paise).
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type Props = {
  assetId: string;
  assetCode: string;
  bookValueMinor: number | string;
};

// YYYY-MM-DD, not in the future — validated manually (never native min/max).
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateEventDate(value: string): string | undefined {
  if (!value.trim()) return undefined; // optional field
  if (!DATE_PATTERN.test(value)) return "Enter a date as YYYY-MM-DD.";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Enter a valid calendar date.";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (parsed.getTime() > today.getTime()) return "Event date cannot be in the future.";
  return undefined;
}

export function AssetFinancialActions({ assetId, assetCode, bookValueMinor }: Props) {
  const router = useRouter();
  const bookValueBig = BigInt(String(bookValueMinor));

  // --- Impairment state ---
  const [impAmount, setImpAmount] = useState("");
  const [impDate, setImpDate] = useState("");
  const [impErrors, setImpErrors] = useState<{ amount?: string; date?: string }>({});
  const [impConfirmOpen, setImpConfirmOpen] = useState(false);
  const [impBusy, setImpBusy] = useState(false);
  const [impDialogError, setImpDialogError] = useState<string | undefined>();
  const [impMessage, setImpMessage] = useState<string | null>(null);

  // --- Revaluation state ---
  const [revValue, setRevValue] = useState("");
  const [revErrors, setRevErrors] = useState<{ value?: string }>({});
  const [revConfirmOpen, setRevConfirmOpen] = useState(false);
  const [revBusy, setRevBusy] = useState(false);
  const [revDialogError, setRevDialogError] = useState<string | undefined>();
  const [revMessage, setRevMessage] = useState<string | null>(null);

  const impAmountId = useId();
  const impDateId = useId();
  const impAmountErrId = useId();
  const impDateErrId = useId();
  const impAmountRef = useRef<HTMLInputElement>(null);
  const impDateRef = useRef<HTMLInputElement>(null);

  const revValueId = useId();
  const revValueErrId = useId();
  const revValueRef = useRef<HTMLInputElement>(null);

  // Computed fresh every render directly from state (never a stale `let`) so the
  // ConfirmDialog description always reflects what will actually be submitted.
  const impAmountMinor = rupeesToMinorString(impAmount);

  function validateImpairment(): boolean {
    const next: { amount?: string; date?: string } = {};
    if (!impAmountMinor) {
      next.amount = "Enter an impairment loss greater than zero, up to 2 decimal places.";
    } else if (BigInt(impAmountMinor) > bookValueBig) {
      next.amount = `Impairment loss cannot exceed the current book value (${formatMoney(bookValueBig)}).`;
    }
    const dateErr = validateEventDate(impDate);
    if (dateErr) next.date = dateErr;

    setImpErrors(next);
    if (next.amount) { impAmountRef.current?.focus(); return false; }
    if (next.date) { impDateRef.current?.focus(); return false; }
    return true;
  }

  function submitImpairment(e: React.FormEvent) {
    e.preventDefault();
    setImpMessage(null);
    if (!validateImpairment()) return;
    setImpDialogError(undefined);
    setImpConfirmOpen(true);
  }

  async function confirmImpairment(reason?: string) {
    setImpBusy(true);
    setImpDialogError(undefined);
    try {
      const amountMinor = rupeesToMinorString(impAmount);
      if (!amountMinor) throw new Error("Enter an impairment loss greater than zero.");
      await browserJson(`v1/asset/assets/${assetId}/impairment`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: Number(amountMinor),
          reason: reason?.trim() || undefined,
          eventDate: impDate.trim() || undefined,
        }),
      });
      setImpConfirmOpen(false);
      setImpMessage(`Impairment of ${formatMoney(amountMinor)} submitted for posting to the GL.`);
      setImpAmount("");
      setImpDate("");
      setImpErrors({});
      router.refresh();
    } catch (err) {
      setImpDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setImpBusy(false);
    }
  }

  const revValueMinor = rupeesToMinorString(revValue);

  function validateRevaluation(): boolean {
    const next: { value?: string } = {};
    if (!revValueMinor) {
      next.value = "Enter the new book value, greater than zero, up to 2 decimal places.";
    }
    setRevErrors(next);
    if (next.value) { revValueRef.current?.focus(); return false; }
    return true;
  }

  function submitRevaluation(e: React.FormEvent) {
    e.preventDefault();
    setRevMessage(null);
    if (!validateRevaluation()) return;
    setRevDialogError(undefined);
    setRevConfirmOpen(true);
  }

  async function confirmRevaluation(reason?: string) {
    setRevBusy(true);
    setRevDialogError(undefined);
    try {
      const newBookValueMinor = rupeesToMinorString(revValue);
      if (!newBookValueMinor) throw new Error("Enter the new book value, greater than zero.");
      await browserJson(`v1/asset/assets/${assetId}/revaluation`, {
        method: "POST",
        body: JSON.stringify({
          newBookValueMinor: Number(newBookValueMinor),
          reason: reason?.trim() || undefined,
        }),
      });
      setRevConfirmOpen(false);
      setRevMessage(`Revaluation to ${formatMoney(newBookValueMinor)} submitted for posting to the GL.`);
      setRevValue("");
      setRevErrors({});
      router.refresh();
    } catch (err) {
      setRevDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setRevBusy(false);
    }
  }

  const revNewBig = revValueMinor ? BigInt(revValueMinor) : null;
  const revDirection = revNewBig === null ? null : revNewBig > bookValueBig ? "upward" : revNewBig < bookValueBig ? "downward" : "unchanged";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <form onSubmit={submitImpairment}>
        <Card title="Record impairment" padding>
          <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 0 }}>
            Current book value: <strong>{formatMoney(bookValueBig)}</strong>. An impairment posts Dr Impairment Loss / Cr Fixed
            Asset to the GL and reduces the book value permanently.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={impAmountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Impairment loss (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={impAmountId}
                ref={impAmountRef}
                inputMode="decimal"
                value={impAmount}
                onChange={(e) => setImpAmount(e.target.value)}
                aria-required="true"
                aria-invalid={!!impErrors.amount || undefined}
                aria-describedby={impErrors.amount ? impAmountErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {impErrors.amount && <p id={impAmountErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{impErrors.amount}</p>}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={impDateId} style={{ fontSize: 13, fontWeight: 600 }}>Event date</label>
              <input
                id={impDateId}
                ref={impDateRef}
                placeholder="YYYY-MM-DD"
                value={impDate}
                onChange={(e) => setImpDate(e.target.value)}
                aria-invalid={!!impErrors.date || undefined}
                aria-describedby={impErrors.date ? impDateErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {impErrors.date && <p id={impDateErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{impErrors.date}</p>}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8, marginBottom: 0 }}>
            You will be asked for a mandatory authorisation reason before this posts to the GL.
          </p>
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn danger" style={{ minHeight: 44 }} disabled={impBusy}>
              Record impairment
            </button>
          </div>
          {impMessage && (
            <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 10 }}>{impMessage}</p>
          )}
        </Card>
      </form>

      <ConfirmDialog
        open={impConfirmOpen}
        title={`Record impairment on ${assetCode}?`}
        confirmLabel="Post impairment"
        danger
        requireReason
        reasonLabel="Authorisation / justification"
        busy={impBusy}
        errorMessage={impDialogError}
        description={
          impAmountMinor ? (
            <>
              Book value moves from <strong>{formatMoney(bookValueBig)}</strong> to{" "}
              <strong>{formatMoney(bookValueBig - BigInt(impAmountMinor))}</strong> — a loss of{" "}
              <strong>{formatMoney(impAmountMinor)}</strong>. This posts a journal to the general ledger and{" "}
              <strong>cannot be undone</strong> from this screen.
            </>
          ) : null
        }
        onConfirm={(reason) => void confirmImpairment(reason)}
        onCancel={() => !impBusy && setImpConfirmOpen(false)}
      />

      <form onSubmit={submitRevaluation}>
        <Card title="Record revaluation" padding>
          <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 0 }}>
            Current book value: <strong>{formatMoney(bookValueBig)}</strong>. Revaluation posts against the Revaluation
            Reserve (equity), not profit &amp; loss — upward or downward, depending on the new value you enter.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={revValueId} style={{ fontSize: 13, fontWeight: 600 }}>
                New book value (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={revValueId}
                ref={revValueRef}
                inputMode="decimal"
                value={revValue}
                onChange={(e) => setRevValue(e.target.value)}
                aria-required="true"
                aria-invalid={!!revErrors.value || undefined}
                aria-describedby={revErrors.value ? revValueErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {revErrors.value && <p id={revValueErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{revErrors.value}</p>}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8, marginBottom: 0 }}>
            You will be asked for a mandatory authorisation reason before this posts to the GL.
          </p>
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={revBusy}>
              Record revaluation
            </button>
          </div>
          {revMessage && (
            <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 10 }}>{revMessage}</p>
          )}
        </Card>
      </form>

      <ConfirmDialog
        open={revConfirmOpen}
        title={`Record revaluation on ${assetCode}?`}
        confirmLabel="Post revaluation"
        danger
        requireReason
        reasonLabel="Authorisation / justification"
        busy={revBusy}
        errorMessage={revDialogError}
        description={
          revValueMinor ? (
            <>
              Book value moves from <strong>{formatMoney(bookValueBig)}</strong> to{" "}
              <strong>{formatMoney(revValueMinor)}</strong> ({revDirection}). This posts a journal to the general
              ledger against the Revaluation Reserve and <strong>cannot be undone</strong> from this screen.
            </>
          ) : null
        }
        onConfirm={(reason) => void confirmRevaluation(reason)}
        onCancel={() => !revBusy && setRevConfirmOpen(false)}
      />
    </div>
  );
}

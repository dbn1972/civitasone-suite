"use client";

import { useState } from "react";
import { ConfirmDialog } from "../../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { formatMoney } from "@/lib/formatters";

type ForceFileResult = {
  deducteeCount: number;
  totalTdsDeducted: number;
  warning?: string;
  note?: string;
};

/**
 * Form-24Q is blocked (409 TDS_RECONCILIATION_FAILED) when TDS deducted does
 * not match deposited challans for the quarter. This lets a payroll/finance
 * officer explicitly bypass that gate — the server records a force_file_24q
 * audit event with the actor, per-period variance, and the typed reason, so
 * the override is never silent.
 *
 * SEC FIX: this used to be `router.push(...&force=1)` — a client-side
 * navigation to a GET URL that ReturnsPage's SSR loader turned into a
 * mutating GET against payroll-service. Because the trigger was just a GET
 * query param, ANY GET to that URL — a browser prefetch, a link-preview
 * crawler, or someone opening a bookmarked/shared link — fired the same
 * bypass + audit event, with no user confirmation at all. The ConfirmDialog
 * only ever gated the button *click*; it never gated the URL itself, and a
 * manual refresh could replay it (StripForceParam only patched that one
 * follow-on case, and has been removed now that the real fix is in).
 *
 * Fixed by moving the bypass to a dedicated POST
 * /v1/payroll/statutory/form24q/force-file endpoint that 400s without a
 * non-empty typed `reason`. There is no longer any URL — bookmarked, shared,
 * or prefetched — that can trigger this; only this confirmed POST can.
 */
export function ForceFileButton({ fy, quarter }: { fy: string; quarter: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ForceFileResult | null>(null);
  const { toast } = useToast();

  async function confirm(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/payroll/statutory/form24q/force-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fy, quarter, confirmForce: true, reason }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && typeof body.message === "string" && body.message) || `Force-file failed (${res.status})`);
        return;
      }
      setResult({
        deducteeCount: Number(body?.deducteeCount ?? 0),
        totalTdsDeducted: Number(body?.totalTdsDeducted ?? 0),
        warning: body?.reconciliation?.warning,
        note: body?.note,
      });
      toast.success(`✓ Form-24Q for FY ${fy} ${quarter} filed with reconciliation override`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        File anyway — bypass reconciliation (force)
      </button>

      {/* Honest, response-driven feedback — this is a synchronous filing (the
          server returns the flagged return directly, no async job), and the
          reconciliation gate stays in force for future reads/downloads of
          this quarter, so we say so rather than implying it's now "fixed". */}
      {result && (
        <p role="status" aria-live="polite" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>
          Filed with override: {result.deducteeCount} deductee{result.deducteeCount === 1 ? "" : "s"},{" "}
          {formatMoney(Math.round(result.totalTdsDeducted * 100))} TDS deducted.{" "}
          {result.warning ?? "Recorded as a flagged/forced return."} This does not fix the underlying
          discrepancy — viewing or downloading this quarter again will still be blocked until challans are
          reconciled in TRACES.
        </p>
      )}

      <ConfirmDialog
        open={open}
        title="File Form-24Q despite unreconciled TDS?"
        confirmLabel="File with confirmed override"
        danger
        requireReason
        reasonLabel="Reason for overriding the reconciliation gate (required)"
        busy={busy}
        errorMessage={error}
        description={
          <>
            TDS deducted for FY <strong>{fy}</strong> {quarter} does not match deposited challans (or no
            challans have been ingested yet). Filing anyway records a{" "}
            <strong>force_file_24q</strong> audit event with your identity, the per-period variance, and the
            reason you give below. This does not fix the underlying discrepancy — reconcile challans in TRACES
            before the statutory due date.
          </>
        }
        onConfirm={confirm}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}

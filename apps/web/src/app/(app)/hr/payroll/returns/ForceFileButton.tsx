"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { formatMoney } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

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
  const t = useTranslations("forceFileButton");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ForceFileResult | null>(null);
  const { toast } = useToast();
  const formError = useFormError("Form-24Q return");

  async function confirm(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/payroll/statutory/form24q/force-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fy, quarter, confirmForce: true, reason }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      const body = await res.json().catch(() => null);
      setResult({
        deducteeCount: Number(body?.deducteeCount ?? 0),
        totalTdsDeducted: Number(body?.totalTdsDeducted ?? 0),
        warning: body?.reconciliation?.warning,
        note: body?.note,
      });
      toast.success(t("filedToast", { fy, quarter }));
      setOpen(false);
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        {t("fileAnywayBtn")}
      </Button>

      {/* Honest, response-driven feedback — this is a synchronous filing (the
          server returns the flagged return directly, no async job), and the
          reconciliation gate stays in force for future reads/downloads of
          this quarter, so we say so rather than implying it's now "fixed". */}
      {result && (
        <p role="status" aria-live="polite" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>
          {t("filedWithOverrideText", {
            count: result.deducteeCount,
            amount: formatMoney(Math.round(result.totalTdsDeducted * 100)),
            note: result.warning ?? t("recordedAsFlaggedFallback"),
          })}
        </p>
      )}

      <ConfirmDialog
        open={open}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("confirmDescription", {
          fy,
          quarter,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={confirm}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}

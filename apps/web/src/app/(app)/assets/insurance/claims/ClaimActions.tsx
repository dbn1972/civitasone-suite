"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, useConfirmAction } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { checkSettlement } from "./claimRules";

/**
 * GAP-ASSETS-INSURANCE-CLAIMS-03 / DETAIL-02: settle or reject a claim.
 * Both are money/approval decisions, so each goes through a confirm dialog;
 * reject needs a reason. The server is authoritative (role, status, cap) and
 * its refusal is shown in the dialog. `x-idempotency-key` is the only header
 * the BFF/gateway forward, so it is generated once per attempt and reused on
 * retry.
 */
export function ClaimActions({ claimId, claimAmountMinor }: { claimId: string; claimAmountMinor: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const settleKey = useRef<string | null>(null);
  const rejectKey = useRef<string | null>(null);

  const settle = useConfirmAction({
    onConfirm: async () => {
      const check = checkSettlement(amount, claimAmountMinor);
      if (!check.ok) throw new Error(check.error);
      settleKey.current ??= crypto.randomUUID();
      await browserJson(`v1/assets/insurance/claims/${encodeURIComponent(claimId)}/settle`, {
        method: "PATCH",
        headers: { "x-idempotency-key": settleKey.current },
        body: JSON.stringify({ settlementAmountMinor: Number(check.minor), currency: "INR" }),
      });
      settleKey.current = null;
    },
    onSuccess: () => router.refresh(),
  });

  const reject = useConfirmAction({
    onConfirm: async (reason) => {
      const text = reason?.trim();
      if (!text) throw new Error("Enter the reason for rejecting this claim.");
      rejectKey.current ??= crypto.randomUUID();
      await browserJson(`v1/assets/insurance/claims/${encodeURIComponent(claimId)}/reject`, {
        method: "PATCH",
        headers: { "x-idempotency-key": rejectKey.current },
        body: JSON.stringify({ reason: text }),
      });
      rejectKey.current = null;
    },
    onSuccess: () => router.refresh(),
  });

  function openSettle() {
    const check = checkSettlement(amount, claimAmountMinor);
    setAmountError(check.ok ? null : check.error);
    if (check.ok) settle.trigger();
  }

  const checked = checkSettlement(amount, claimAmountMinor);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, maxWidth: 320 }}>
        <label htmlFor="claim-settle-amount" style={{ fontSize: 13, fontWeight: 600 }}>
          Settled amount (₹)
        </label>
        <input
          id="claim-settle-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountError(null);
          }}
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? "claim-settle-amount-error" : undefined}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
        {amountError ? (
          <p id="claim-settle-amount-error" role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {amountError}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button type="button" onClick={openSettle} style={{ minHeight: 44 }}>
          Settle claim
        </Button>
        <Button type="button" variant="ghost" onClick={reject.trigger} style={{ minHeight: 44 }}>
          Reject claim
        </Button>
      </div>

      <ConfirmDialog
        open={settle.open}
        title="Settle this claim?"
        description={
          checked.ok ? (
            <>
              Record a settlement of <b>{formatMoney(checked.minor)}</b> against a claim of <b>{formatMoney(claimAmountMinor)}</b>.
            </>
          ) : null
        }
        confirmLabel="Settle claim"
        busy={settle.busy}
        errorMessage={settle.error}
        onConfirm={() => void settle.confirm()}
        onCancel={settle.cancel}
      />
      <ConfirmDialog
        open={reject.open}
        title="Reject this claim?"
        description="The claim will be closed as rejected and no longer counts against the policy's sum insured."
        confirmLabel="Reject claim"
        danger
        requireReason
        reasonLabel="Reason for rejection"
        busy={reject.busy}
        errorMessage={reject.error}
        onConfirm={(reason) => void reject.confirm(reason)}
        onCancel={reject.cancel}
      />
    </div>
  );
}

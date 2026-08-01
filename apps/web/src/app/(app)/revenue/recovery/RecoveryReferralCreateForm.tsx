"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function RecoveryReferralCreateForm({ assesseeId }: { assesseeId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ reason?: string }>({});

  const reasonId = useId();
  const summaryId = useId();
  const reasonErrorId = `${reasonId}-error`;

  const reasonRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: { reason?: string } = {};
    if (!reason.trim()) errors.reason = "Reason is required.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      reasonRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitReferral() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/recovery-referrals", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          reason: reason.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(res.id ? `Recovery referral recorded (id ${res.id}).` : "Recovery referral recorded.");
      setReason("");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label={`Refer assessee ${assesseeId} for recovery`}>
      <Card title="Refer for Recovery" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>
              Reason{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                *
              </span>
            </label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              aria-required="true"
              aria-invalid={!!fieldErrors.reason || undefined}
              aria-describedby={fieldErrors.reason ? reasonErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)" }}
            />
            {fieldErrors.reason && (
              <p id={reasonErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.reason}
              </p>
            )}
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Refer for Recovery
            </button>
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
        title="Refer this assessee for recovery?"
        confirmLabel="Refer for recovery"
        danger
        busy={busy}
        errorMessage={dialogError}
        description="This refers the assessee's outstanding arrears for coercive recovery action and takes effect immediately — there is no separate checker approval step for referrals."
        onConfirm={() => void submitReferral()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

/** Owner decision #4: what the officer must see before a coercive referral. */
export type RecoveryReadiness = {
  outstandingMinor: string;
  eligible: boolean;
  notices: ReadonlyArray<{
    id: string;
    noticeNo: string;
    servedOn: string;
    noticePeriodDays: number;
    lapsesOn: string;
    lapsed: boolean;
  }>;
};

export function RecoveryReferralCreateForm({
  assesseeId,
  readiness,
}: {
  assesseeId: string;
  /**
   * undefined = no gating UI (legacy callers); null = eligibility could not be
   * loaded (fail closed: form disabled); object = show amount + notices and
   * disable when not eligible. The server re-enforces the same rules.
   */
  readiness?: RecoveryReadiness | null;
}) {
  const blocked = readiness === null || (readiness !== undefined && !readiness.eligible);
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
      setMessage(
        res.id
          ? `Recovery referral raised (id ${res.id}) and sent for approval. Nothing is referred until a different officer approves it.`
          : "Recovery referral raised and sent for approval. Nothing is referred until a different officer approves it.",
      );
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
          {readiness === null && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>
              We couldn&apos;t check this assessee&apos;s arrears and notices, so a referral can&apos;t be raised safely
              right now. Try again in a moment.
            </p>
          )}
          {readiness && (
            <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
              <p style={{ margin: 0 }}>
                Outstanding arrears: <strong>{formatMoney(readiness.outstandingMinor)}</strong>
              </p>
              <ul aria-label="Demand notices served" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                {readiness.notices.length === 0 ? (
                  <li>No demand notice on record.</li>
                ) : (
                  readiness.notices.map((n) => (
                    <li key={n.id}>
                      <span className="mono">{n.noticeNo}</span> — served {formatIndianDate(n.servedOn)}, {n.noticePeriodDays}-day
                      period {n.lapsed ? "lapsed" : "runs to"} {formatIndianDate(n.lapsesOn)}
                      {n.lapsed ? " (period lapsed)" : " (period still running)"}
                    </li>
                  ))
                )}
              </ul>
              {!readiness.eligible && (
                <p role="status" style={{ margin: 0, color: "var(--bad)" }}>
                  {readiness.notices.length === 0
                    ? "No demand notice has been served, so a recovery referral is not allowed yet."
                    : readiness.outstandingMinor === "0" || readiness.outstandingMinor.startsWith("-")
                      ? "This assessee has no outstanding arrears, so a recovery referral is not allowed."
                      : "The notice period has not lapsed yet, so a recovery referral is not allowed."}
                </p>
              )}
            </div>
          )}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>
              Reason{" "}
              <span aria-hidden="true" style={{ color: "var(--bad)" }}>
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
              <p id={reasonErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                {fieldErrors.reason}
              </p>
            )}
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy || blocked} loading={busy}>
              Refer for Recovery
            </Button>
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
        description="This raises a referral of the assessee's outstanding arrears for coercive recovery action. It is not referred to legal until a different officer must approve it — you cannot approve your own referral."
        onConfirm={() => void submitReferral()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

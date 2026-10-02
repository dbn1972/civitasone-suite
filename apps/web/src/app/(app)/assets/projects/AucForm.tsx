"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type FieldErrors = {
  projectCode?: string;
  name?: string;
  amount?: string;
};

/**
 * Largest paise amount the asset-service create endpoint can take: its zod body
 * is `z.number().int()`, so the value crosses the wire as a JSON number and must
 * stay a safe integer (GAP-ASSETS-PROJECTS-04). Above this a rupee amount would
 * be silently rounded, so the form rejects it instead.
 */
export const MAX_AMOUNT_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Parses the opening-cost field (rupees) into a paise digit string. Blank and an
 * explicit 0 / 0.00 are both a legitimate zero opening WIP (GAP-ASSETS-PROJECTS-03);
 * negatives, more than 2 decimals and over-large values are rejected.
 */
export function parseOpeningCost(input: string): { ok: true; minor: string } | { ok: false; reason: "invalid" | "too_large" } {
  if (!input.trim()) return { ok: true, minor: "0" };
  const minor = rupeesToMinorString(input, { allowZero: true });
  if (minor === null) return { ok: false, reason: "invalid" };
  if (BigInt(minor) > MAX_AMOUNT_MINOR) return { ok: false, reason: "too_large" };
  return { ok: true, minor };
}

export function AucForm({ disabledReason }: { disabledReason?: string } = {}) {
  const router = useRouter();

  const [projectCode, setProjectCode] = useState("");
  const [name, setName] = useState("");
  const [wbsRef, setWbsRef] = useState("");
  const [amount, setAmount] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const codeId = useId();
  const nameId = useId();
  const wbsId = useId();
  const amountId = useId();
  const codeErrId = useId();
  const nameErrId = useId();
  const amountErrId = useId();

  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  function validate(): string | null {
    const next: FieldErrors = {};
    if (!projectCode.trim()) next.projectCode = "Project code is required.";
    if (!name.trim()) next.name = "Project name is required.";
    const parsed = parseOpeningCost(amount);
    let amountMinor: string | null = null;
    if (parsed.ok) amountMinor = parsed.minor;
    else next.amount = parsed.reason === "too_large"
      ? "This amount is too large to record. Check the figure is in rupees."
      : "Enter a valid amount in rupees (0 or more), up to 2 decimal places.";

    setErrors(next);
    if (next.projectCode) { codeRef.current?.focus(); return null; }
    if (next.name) { nameRef.current?.focus(); return null; }
    if (next.amount) { amountRef.current?.focus(); return null; }
    return amountMinor;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabledReason) return;
    setMessage(null);
    const amountMinor = validate();
    if (amountMinor === null) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createAuc(reason: string | undefined) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const parsed = parseOpeningCost(amount);
      if (!parsed.ok) { setDialogError("Enter a valid opening cost."); return; }
      const res = await browserJson<{ id: string }>("v1/asset/projects/auc", {
        method: "POST",
        body: JSON.stringify({
          projectCode: projectCode.trim(),
          name: name.trim(),
          wbsRef: wbsRef.trim() || undefined,
          // PAISE, guarded to a safe integer by parseOpeningCost (the endpoint takes a JSON number).
          amountMinor: Number(parsed.minor),
          reason: reason?.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(res?.id ? `AUC project "${projectCode.trim()}" created.` : "AUC project created.");
      setProjectCode("");
      setName("");
      setWbsRef("");
      setAmount("");
      setErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const parsedPreview = parseOpeningCost(amount);
  const previewMinor = parsedPreview.ok ? parsedPreview.minor : null;

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create AUC Project" padding>
        <div style={{ display: "grid", gap: 14 }}>
          {disabledReason ? (
            <p role="alert" className="pill warn" style={{ width: "fit-content", margin: 0 }}>{disabledReason}</p>
          ) : null}
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={codeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Project code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={codeId}
                ref={codeRef}
                value={projectCode}
                onChange={(e) => setProjectCode(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={!!errors.projectCode || undefined}
                aria-describedby={errors.projectCode ? codeErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.projectCode && <p id={codeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.projectCode}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                Project name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={nameId}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={256}
                aria-required="true"
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? nameErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.name && <p id={nameErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.name}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={wbsId} style={{ fontSize: 13, fontWeight: 600 }}>WBS reference</label>
              <input
                id={wbsId}
                value={wbsRef}
                onChange={(e) => setWbsRef(e.target.value)}
                maxLength={64}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>Accumulated cost so far (₹)</label>
              <input
                id={amountId}
                ref={amountRef}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                aria-invalid={!!errors.amount || undefined}
                aria-describedby={errors.amount ? amountErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.amount && <p id={amountErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.amount}</p>}
              {!errors.amount && amount.trim() && previewMinor !== null && (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{formatMoney(previewMinor)} will be recorded as opening WIP.</p>
              )}
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy || Boolean(disabledReason)}>
              Create AUC project
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
        title="Create this AUC project?"
        confirmLabel="Confirm & create"
        requireReason
        reasonLabel="Reason / authorisation"
        minReasonLength={3}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create work-in-progress project <strong>{projectCode || "—"}</strong> — <strong>{name || "—"}</strong>
            {previewMinor !== null ? <> with opening accumulated cost <strong>{formatMoney(previewMinor)}</strong></> : null}. This
            does not post to the GL until it is capitalized.
          </>
        }
        onConfirm={(reason) => void createAuc(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

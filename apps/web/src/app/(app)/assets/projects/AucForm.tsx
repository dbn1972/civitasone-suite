"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type FieldErrors = {
  projectCode?: string;
  name?: string;
  amount?: string;
};

export function AucForm() {
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
    let amountMinor: string | null = null;
    if (amount.trim()) {
      amountMinor = rupeesToMinorString(amount);
      if (!amountMinor) next.amount = "Enter a valid amount in rupees, up to 2 decimal places.";
    }

    setErrors(next);
    if (next.projectCode) { codeRef.current?.focus(); return null; }
    if (next.name) { nameRef.current?.focus(); return null; }
    if (next.amount) { amountRef.current?.focus(); return null; }
    return amountMinor ?? "0";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const amountMinor = validate();
    if (amountMinor === null) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createAuc() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const amountMinor = amount.trim() ? rupeesToMinorString(amount) : "0";
      const res = await browserJson<{ id: string }>("v1/asset/projects/auc", {
        method: "POST",
        body: JSON.stringify({
          projectCode: projectCode.trim(),
          name: name.trim(),
          wbsRef: wbsRef.trim() || undefined,
          amountMinor: Number(amountMinor ?? "0"),
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

  const previewMinor = amount.trim() ? rupeesToMinorString(amount) : null;

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create AUC Project" padding>
        <div style={{ display: "grid", gap: 14 }}>
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
              {!errors.amount && previewMinor && (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{formatMoney(previewMinor)} will be recorded as opening WIP.</p>
              )}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create AUC project
            </button>
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
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create work-in-progress project <strong>{projectCode || "—"}</strong> — <strong>{name || "—"}</strong>
            {previewMinor ? <> with opening accumulated cost <strong>{formatMoney(previewMinor)}</strong></> : null}. This
            does not post to the GL until it is capitalized.
          </>
        }
        onConfirm={() => void createAuc()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { Button, Field, Input, Textarea, EntityPicker, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear } from "@/lib/fiscalYear";
import { searchWorkProposals, resolveWorkProposals } from "@/lib/entityAdapters/workProposal";
import { searchIdentityUsers, resolveIdentityUsers } from "@/lib/entityAdapters/identityUser";

// Token-based banner styles (no hard-coded hex — GAP-WORKS-APPROVALS-NEW-04).
const okBanner: React.CSSProperties = {
  background: "var(--good-bg, #ecfdf3)",
  color: "var(--good, #166534)",
  padding: 12,
  borderRadius: 12,
  fontSize: 13,
};
const errBanner: React.CSSProperties = {
  background: "var(--bad-bg, #fef2f2)",
  color: "var(--bad, #b42318)",
  padding: 12,
  borderRadius: 12,
  fontSize: 13,
};

// Upper bound: ₹999,99,99,999.99 (just under 1,000 crore) in paise. Guards a
// fat-fingered extra digit from sending an absurd sanction amount.
const MAX_AMOUNT_MINOR = 99999999999n;

export function NewAaForm() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  // Pre-fill the Work from the ?workId= param so the "Create AA →" button on a
  // proposal carries its context through; the picker resolves the id to the
  // work's number/description for display.
  const prefilledWorkId = searchParams.get("workId") ?? "";
  const [form, setForm] = useState({
    workId: prefilledWorkId,
    aaNumber: "",
    aaDate: "",
    approvingAuthorityId: "",
    approvedAmount: "",
    remarks: "",
  });
  const [amountError, setAmountError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formError = useFormError("administrative approval");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function validateAmount(): string | null {
    const minor = rupeesToMinorString(form.approvedAmount.trim());
    if (minor === null) {
      return "Enter a valid amount in rupees (greater than zero, up to two decimals).";
    }
    if (BigInt(minor) > MAX_AMOUNT_MINOR) {
      return "Amount is too large. Check the figure and try again.";
    }
    return null;
  }

  // Open the confirmation dialog after client-side validation of the amount —
  // the actual POST only fires from the dialog's confirm (GAP-WORKS-APPROVALS-NEW-03).
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const amtErr = validateAmount();
    setAmountError(amtErr ?? "");
    if (amtErr) return;
    setConfirmOpen(true);
  }

  async function doCreate() {
    setBusy(true);
    setError("");
    formError.clear();
    try {
      const approvedAmountMinor = rupeesToMinorString(form.approvedAmount.trim());
      if (approvedAmountMinor === null) {
        setAmountError("Enter a valid amount in rupees (greater than zero, up to two decimals).");
        setConfirmOpen(false);
        return;
      }
      const body: Record<string, string> = {
        workId: form.workId.trim(),
        aaNumber: form.aaNumber.trim(),
        aaDate: form.aaDate,
        approvingAuthorityId: form.approvingAuthorityId.trim(),
        approvedAmountMinor,
      };
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/approvals/aa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setConfirmOpen(false);
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // The service accepts the create asynchronously (HTTP 202) — the record is
      // queued, not yet written — so we say "submitted", not "created".
      setConfirmOpen(false);
      setMessage("Administrative approval submitted. It will appear in the register once processed.");
      toast.success("Administrative approval submitted.");
      setTimeout(() => router.push("/works/approvals"), 700);
    } catch (caught) {
      setConfirmOpen(false);
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const amountMinorPreview = rupeesToMinorString(form.approvedAmount.trim());

  return (
    <>
      {message ? (
        <div role="status" aria-live="polite" style={{ ...okBanner, marginBottom: 16 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" style={{ ...errBanner, marginBottom: 16 }}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form
          onSubmit={onSubmit}
          noValidate
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <Field label="Work" required id="aa-workId">
              <EntityPicker
                id="aa-workId"
                value={form.workId || null}
                onChange={(v) => setForm((prev) => ({ ...prev, workId: Array.isArray(v) ? (v[0] ?? "") : (v ?? "") }))}
                search={searchWorkProposals}
                resolve={resolveWorkProposals}
                placeholder="Search by work number or description…"
                aria-label="Work"
              />
              {prefilledWorkId ? (
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Pre-filled from the selected proposal.</p>
              ) : null}
            </Field>

            <Field label="AA Number" required id="aa-number">
              <Input
                id="aa-number"
                type="text"
                value={form.aaNumber}
                onChange={set("aaNumber")}
                placeholder={`e.g. AA/${currentFinancialYear()}/001`}
                maxLength={64}
              />
            </Field>

            <Field label="Approval date" required id="aa-date">
              <Input id="aa-date" type="date" value={form.aaDate} onChange={set("aaDate")} />
            </Field>

            <Field label="Approving authority" required id="aa-authority">
              <EntityPicker
                id="aa-authority"
                value={form.approvingAuthorityId || null}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, approvingAuthorityId: Array.isArray(v) ? (v[0] ?? "") : (v ?? "") }))
                }
                search={searchIdentityUsers}
                resolve={resolveIdentityUsers}
                placeholder="Search by officer name…"
                aria-label="Approving authority"
              />
            </Field>

            <Field
              label="Approved amount (₹)"
              required
              id="aa-amount"
              error={amountError || undefined}
            >
              <Input
                id="aa-amount"
                type="text"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                value={form.approvedAmount}
                onChange={(e) => {
                  setAmountError("");
                  set("approvedAmount")(e);
                }}
                placeholder="0.00"
              />
            </Field>
          </div>

          <Field label="Remarks" id="aa-remarks">
            <Textarea
              id="aa-remarks"
              style={{ minHeight: 80 }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional notes or remarks"
            />
          </Field>

          <div style={{ display: "flex", gap: 12 }}>
            <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Submitting..." : "Create"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push("/works/approvals")}
              disabled={busy}
              style={{ minHeight: 44 }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create Administrative Approval"
        description={
          `Create AA ${form.aaNumber || "(no number)"} for ${
            amountMinorPreview !== null ? formatMoney(amountMinorPreview) : "an unspecified amount"
          }? It will be submitted for processing.`
        }
        confirmLabel="Create"
        busy={busy}
        onConfirm={doCreate}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import type { AccountSummary } from "@civitasone/types";
import { formatMoney } from "@/lib/formatters";
import { Button, ConfirmDialog, HelpTip } from "@/app/_components/ds";
import { explain } from "@/lib/glossary";
import { trackActivation } from "@/lib/activation";
import { useFormError } from "@/lib/useFormError";

type Props = {
  accounts: AccountSummary[];
  /** Where to go after a successful post (vouchers/new redirects to the GL). */
  redirectTo?: string;
};

type JournalLine = {
  id: number;
  accountCode: string;
  debit: string;
  credit: string;
};

let _lineId = 0;
function nextId() { return ++_lineId; }

function emptyLine(defaultCode = ""): JournalLine {
  return { id: nextId(), accountCode: defaultCode, debit: "", credit: "" };
}

function rupeesToPaise(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

type FieldErrors = {
  voucherNo?: string;
  narration?: string;
  postingDate?: string;
  lines?: Record<number, string>;
  balance?: string;
};

export function JournalEntryForm({ accounts, redirectTo }: Props) {
  const defaultDebit  = accounts.find((a) => a.type === "asset")?.code     ?? accounts[0]?.code ?? "1000";
  const defaultCredit = accounts.find((a) => a.type === "liability")?.code ?? accounts[1]?.code ?? "2000";

  const [voucherNo,  setVoucherNo]  = useState("");
  const [narration,  setNarration]  = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<JournalLine[]>([
    emptyLine(defaultDebit),
    emptyLine(defaultCredit),
  ]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status,  setStatus]  = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formError = useFormError("journal entry");
  // EVT-4 (accounting-high-findings): one idempotency key per logical
  // submission attempt. The backend mechanism (idempotentId() in
  // @civitasone/auth, tenant-scoped as of PR #1565) and the full header path
  // (this form -> /api/proxy -> gateway -> finance-service, all already
  // forward x-idempotency-key) were already correct and already wired end to
  // end -- no frontend caller ever generated or sent the header, so a
  // double-click or a retried request always produced two distinct
  // journal.create commands and, per PR #1565's finding #4 writeup, silent
  // duplicate/lost-write risk. Held in state (not regenerated on every
  // render or every open-confirm) so a retry of the *same* attempt --
  // ConfirmDialog re-firing onConfirm, or a caller re-invoking doPost after
  // a transient failure -- reuses the same key and dedupes at the consumer's
  // inbox; rotated only once an attempt actually succeeds (below), so the
  // next, genuinely different entry is never mistaken for a repeat of this one.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  /* ── line helpers ───────────────────────────────────────────── */
  function updateLine(id: number, field: keyof Omit<JournalLine, "id">, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine("")]);
  }

  function removeLine(id: number) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  /* ── totals ─────────────────────────────────────────────────── */
  const totalDebitPaise  = lines.reduce((s, l) => s + rupeesToPaise(l.debit),  0);
  const totalCreditPaise = lines.reduce((s, l) => s + rupeesToPaise(l.credit), 0);
  const diffPaise = totalDebitPaise - totalCreditPaise;
  const balanced = totalDebitPaise > 0 && diffPaise === 0;

  /* ── validation (per-field) ─────────────────────────────────── */
  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!voucherNo.trim()) e.voucherNo = "Voucher number is required.";
    if (!narration.trim()) e.narration = "Narration is required.";
    if (!postingDate) e.postingDate = "Posting date is required.";
    const lineErrs: Record<number, string> = {};
    lines.forEach((l) => {
      if (!l.accountCode.trim()) lineErrs[l.id] = "Select an account.";
      else if (rupeesToPaise(l.debit) > 0 && rupeesToPaise(l.credit) > 0)
        lineErrs[l.id] = "A line cannot have both a debit and a credit.";
    });
    if (Object.keys(lineErrs).length) e.lines = lineErrs;
    if (!balanced) {
      e.balance =
        totalDebitPaise === 0
          ? "Enter at least one debit and matching credit."
          : `Journal does not balance — debit ${formatMoney(totalDebitPaise)} vs credit ${formatMoney(totalCreditPaise)} (difference ${formatMoney(Math.abs(diffPaise))}).`;
    }
    return e;
  }

  /* ── request submit → opens confirm (maker-checker) ─────────── */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setStatus("error");
      setMessage("Please correct the highlighted fields before posting.");
      return;
    }
    setStatus("idle");
    setMessage("");
    setConfirmOpen(true);
  }

  /* ── confirmed post ─────────────────────────────────────────── */
  async function doPost(reason?: string) {
    setStatus("submitting");
    setMessage("");
    formError.clear();

    const body = {
      voucherNo:   voucherNo.trim(),
      type:        "journal" as const,
      postingDate,
      narration:   narration.trim(),
      reason:      reason ?? undefined,
      lines: lines.map((l) => ({
        accountCode:  l.accountCode.trim(),
        // Backend's zMoneyMinor (gl/validators.ts) accepts only a digit-string
        // or a real bigint — JSON has neither a bigint type nor an implicit
        // number->string coercion, so sending the raw number here made every
        // submission 400 with "Invalid input" on both fields, every time.
        debitMinor:   String(rupeesToPaise(l.debit)),
        creditMinor:  String(rupeesToPaise(l.credit)),
      })),
    };

    const res = await fetch("/api/proxy/v1/finance/journals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });

    if (res.status === 200 || res.status === 201 || res.status === 202) {
      setConfirmOpen(false);
      setStatus("accepted");
      // Activation funnel: a posted journal is a real first transaction.
      trackActivation("first_transaction");
      setMessage(
        res.status === 202
          ? "Journal entry accepted for processing (202)."
          : "Journal entry posted successfully."
      );
      // EVT-4: this attempt succeeded -- rotate to a fresh key so the next,
      // distinct entry can't be deduped against this one's messageId.
      setIdempotencyKey(crypto.randomUUID());
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      /* reset form */
      setVoucherNo("");
      setNarration("");
      setPostingDate(new Date().toISOString().slice(0, 10));
      setLines([emptyLine(defaultDebit), emptyLine(defaultCredit)]);
      setErrors({});
      return;
    }

    const resolved = await formError.fromResponse(res, "save");
    setStatus("error");
    setMessage(resolved.message);
    // Surface the error inside the dialog by throwing for ConfirmDialog's busy/error flow.
    throw new Error(resolved.message);
  }

  const errId = "jv-form-error";

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <form className="fields" onSubmit={handleSubmit} noValidate aria-describedby={message ? errId : undefined}>
      {/* ── header fields ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div className="field">
          <label className="label" htmlFor="jv-voucher">
            Voucher Number
            <HelpTip term="Voucher">{explain("Voucher")}</HelpTip>
          </label>
          <input
            id="jv-voucher"
            className="input"
            placeholder="e.g. JV-2026-001"
            value={voucherNo}
            onChange={(e) => setVoucherNo(e.target.value)}
            aria-invalid={errors.voucherNo ? true : undefined}
            aria-describedby={errors.voucherNo ? "jv-voucher-err" : undefined}
          />
          {errors.voucherNo && <span id="jv-voucher-err" style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 2, display: "block" }} role="alert">{errors.voucherNo}</span>}
          {formError.fieldError("voucherNo") && <span style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 2, display: "block" }} role="alert">{formError.fieldError("voucherNo")}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="jv-date">Posting Date</label>
          <input
            id="jv-date"
            className="input"
            type="date"
            value={postingDate}
            onChange={(e) => setPostingDate(e.target.value)}
            aria-invalid={errors.postingDate ? true : undefined}
            aria-describedby={errors.postingDate ? "jv-date-err" : undefined}
          />
          {errors.postingDate && <span id="jv-date-err" style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 2, display: "block" }} role="alert">{errors.postingDate}</span>}
          {formError.fieldError("postingDate") && <span style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 2, display: "block" }} role="alert">{formError.fieldError("postingDate")}</span>}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="jv-narration">Narration</label>
        <input
          id="jv-narration"
          className="input"
          placeholder="Brief description of the transaction"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          aria-invalid={errors.narration ? true : undefined}
          aria-describedby={errors.narration ? "jv-narration-err" : undefined}
        />
        {errors.narration && <span id="jv-narration-err" style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 2, display: "block" }} role="alert">{errors.narration}</span>}
        {formError.fieldError("narration") && <span style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 2, display: "block" }} role="alert">{formError.fieldError("narration")}</span>}
      </div>

      {/* ── journal lines ── */}
      <fieldset style={{ marginTop: "16px", border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: "6px", padding: 0 }}>
          Journal Lines
          <HelpTip term="Double-entry">
            Every entry has two sides — money going out (debit) and money coming in (credit). The two sides must add up to the same total before you can post.
          </HelpTip>
        </legend>

        {/* header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr auto",
            gap: "8px",
            fontSize: "0.75rem",
            color: "var(--ink2, #64748b)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "4px",
          }}
        >
          <span>Account Code</span>
          <span>Debit (₹)</span>
          <span>Credit (₹)</span>
          <span />
        </div>

        {lines.map((line, idx) => {
          const lineErr = errors.lines?.[line.id];
          return (
          <div
            key={line.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr auto",
              gap: "8px",
              marginBottom: lineErr ? "2px" : "6px",
              alignItems: "center",
            }}
          >
            {accounts.length > 0 ? (
              <select
                className="input"
                value={line.accountCode}
                onChange={(e) => updateLine(line.id, "accountCode", e.target.value)}
                aria-label={`Account code, line ${idx + 1}`}
                aria-invalid={lineErr ? true : undefined}
              >
                <option value="">— select account —</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                placeholder="Account code"
                value={line.accountCode}
                onChange={(e) => updateLine(line.id, "accountCode", e.target.value)}
                aria-label={`Account code, line ${idx + 1}`}
                aria-invalid={lineErr ? true : undefined}
              />
            )}
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={line.debit}
              onChange={(e) => updateLine(line.id, "debit", e.target.value)}
              aria-label={`Debit amount, line ${idx + 1}`}
            />
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={line.credit}
              onChange={(e) => updateLine(line.id, "credit", e.target.value)}
              aria-label={`Credit amount, line ${idx + 1}`}
            />
            <Button
              type="button"
              onClick={() => removeLine(line.id)}
              disabled={lines.length <= 2}
              variant="ghost"
              style={{ minWidth: 44, minHeight: 44, padding: 0, lineHeight: 1 }}
              title="Remove line"
              aria-label={`Remove line ${idx + 1}`}
            >
              ×
            </Button>
            {lineErr && (
              <span role="alert" style={{ fontSize: "0.75rem", color: "#b91c1c", display: "block", gridColumn: "1 / -1", marginBottom: 4 }}>
                {lineErr}
              </span>
            )}
          </div>
        );})}

        <Button
          type="button"
          onClick={addLine}
          style={{ marginTop: "4px", minHeight: 44 }}
        >
          + Add Line
        </Button>
      </fieldset>

      {/* ── totals ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr auto",
          gap: "8px",
          marginTop: "8px",
          padding: "8px 0",
          borderTop: "1px solid var(--line2, #e2e8f0)",
          fontWeight: 600,
          fontSize: "0.9rem",
          alignItems: "center",
        }}
      >
        <span style={{ color: "var(--ink2, #475569)" }}>Totals</span>
        {/* Zero-total color: var(--mut) measured 4.2:1 against this totals
            row's actual background (#eaecf0 / --line) -- just under 4.5:1,
            since --mut was tuned for white/near-white. var(--ink2) reaches
            6.5:1 here. UX-005 tranche 5. */}
        <span className="num" style={{ color: totalDebitPaise > 0 ? "var(--primary-d, #1e40af)" : "var(--ink2)" }}>
          {formatMoney(totalDebitPaise)}
        </span>
        <span className="num" style={{ color: totalCreditPaise > 0 ? "var(--primary-d, #1e40af)" : "var(--ink2)" }}>
          {formatMoney(totalCreditPaise)}
        </span>
        <span
          role="status"
          aria-live="polite"
          style={{
            fontSize: "0.78rem",
            color: balanced ? "#15803d" : totalDebitPaise === 0 ? "#64748b" : "#b91c1c",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {balanced ? (
            <><span aria-hidden="true">✓ </span>Balanced</>
          ) : totalDebitPaise === 0 ? (
            "Not started"
          ) : (
            <><span aria-hidden="true">✗ </span>Out of balance</>
          )}
        </span>
      </div>

      {errors.balance && <p role="alert" style={{ fontSize: "0.75rem", color: "#b91c1c", display: "block", marginTop: 4 }}>{errors.balance}</p>}

      {/* ── actions ── */}
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <Button
          type="submit"
          disabled={status === "submitting"}
          style={{ minHeight: 44 }}
        >
          {status === "submitting" ? "Submitting…" : "Post Journal Entry"}
        </Button>
      </div>

      {/* ── feedback ── */}
      {message && (
        <p
          id={errId}
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{
            fontSize: "0.85rem",
            marginTop: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            background: status === "error" ? "#fef2f2" : "#f0fdf4",
            color: status === "error" ? "#b91c1c" : "#15803d",
            border: `1px solid ${status === "error" ? "#fecaca" : "#bbf7d0"}`,
          }}
        >
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Post this journal entry?"
        danger
        requireReason
        reasonLabel="Reason / authority for posting (maker-checker)"
        confirmLabel="Post entry"
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              Posting writes <strong>{lines.length}</strong> balanced lines to the general
              ledger. This is an irreversible accounting action.
            </p>
            <p style={{ margin: 0 }}>
              Debit <strong>{formatMoney(totalDebitPaise)}</strong> · Credit{" "}
              <strong>{formatMoney(totalCreditPaise)}</strong>
              {voucherNo.trim() ? <> · Voucher <strong>{voucherNo.trim()}</strong></> : null}
            </p>
          </>
        }
        busy={status === "submitting"}
        errorMessage={status === "error" && confirmOpen ? message : undefined}
        onConfirm={(reason) => {
          // ConfirmDialog/useConfirmAction is not in play here; emulate its busy/error
          // handling by catching the thrown error so the dialog stays open on failure.
          doPost(reason).catch(() => {/* message already set; dialog shows errorMessage */});
        }}
        onCancel={() => {
          if (status !== "submitting") setConfirmOpen(false);
        }}
      />
    </form>
  );
}

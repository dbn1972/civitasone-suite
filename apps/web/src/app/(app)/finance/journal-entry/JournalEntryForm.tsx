"use client";

import { useMemo, useState } from "react";
import type { AccountSummary } from "@civitasone/types";
import { formatMoney } from "@/lib/formatters";
import { ConfirmDialog } from "@/app/_components/ds";
import { HelpTip } from "@/app/_components/ds";
import { explain } from "@/lib/glossary";

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

    const body = {
      voucherNo:   voucherNo.trim(),
      type:        "journal" as const,
      postingDate,
      narration:   narration.trim(),
      reason:      reason ?? undefined,
      lines: lines.map((l) => ({
        accountCode:  l.accountCode.trim(),
        debitMinor:   rupeesToPaise(l.debit),
        creditMinor:  rupeesToPaise(l.credit),
      })),
    };

    const res = await fetch("/api/proxy/v1/finance/journals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (res.status === 200 || res.status === 201 || res.status === 202) {
      setConfirmOpen(false);
      setStatus("accepted");
      setMessage(
        res.status === 202
          ? "Journal entry accepted for processing (202)."
          : "Journal entry posted successfully."
      );
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

    let msg: string;
    try {
      const json = JSON.parse(text);
      msg = json?.message ?? json?.error ?? text ?? `Request failed (${res.status})`;
    } catch {
      msg = text || `Request failed (${res.status})`;
    }
    setStatus("error");
    setMessage(msg);
    // Surface the error inside the dialog by throwing for ConfirmDialog's busy/error flow.
    throw new Error(msg);
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
            <button
              type="button"
              onClick={() => removeLine(line.id)}
              disabled={lines.length <= 2}
              className="btn ghost"
              style={{ minWidth: 44, minHeight: 44, padding: 0, lineHeight: 1 }}
              title="Remove line"
              aria-label={`Remove line ${idx + 1}`}
            >
              ×
            </button>
            {lineErr && (
              <span role="alert" style={{ fontSize: "0.75rem", color: "#b91c1c", display: "block", gridColumn: "1 / -1", marginBottom: 4 }}>
                {lineErr}
              </span>
            )}
          </div>
        );})}

        <button
          type="button"
          onClick={addLine}
          className="btn"
          style={{ marginTop: "4px", minHeight: 44 }}
        >
          + Add Line
        </button>
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
        <span className="num" style={{ color: totalDebitPaise > 0 ? "var(--primary-d, #1e40af)" : "#94a3b8" }}>
          {formatMoney(totalDebitPaise)}
        </span>
        <span className="num" style={{ color: totalCreditPaise > 0 ? "var(--primary-d, #1e40af)" : "#94a3b8" }}>
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
        <button
          type="submit"
          disabled={status === "submitting"}
          className="btn primary"
          style={{ minHeight: 44 }}
        >
          {status === "submitting" ? "Submitting…" : "Post Journal Entry"}
        </button>
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

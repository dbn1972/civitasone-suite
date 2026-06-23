"use client";

import { useState } from "react";
import type { AccountSummary } from "@civitasone/types";

type Props = {
  accounts: AccountSummary[];
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

export function JournalEntryForm({ accounts }: Props) {
  const defaultDebit  = accounts.find((a) => a.type === "asset")?.code     ?? accounts[0]?.code ?? "1000";
  const defaultCredit = accounts.find((a) => a.type === "liability")?.code ?? accounts[1]?.code ?? "2000";

  const [voucherNo,  setVoucherNo]  = useState("");
  const [narration,  setNarration]  = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<JournalLine[]>([
    emptyLine(defaultDebit),
    emptyLine(defaultCredit),
  ]);
  const [status,  setStatus]  = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

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
  const balanced = totalDebitPaise > 0 && totalDebitPaise === totalCreditPaise;

  function fmt(paise: number) {
    return (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  }

  /* ── submit ─────────────────────────────────────────────────── */
  async function handlePost(e: React.FormEvent) {
    e.preventDefault();

    if (!voucherNo.trim()) {
      setStatus("error");
      setMessage("Voucher number is required.");
      return;
    }
    if (!narration.trim()) {
      setStatus("error");
      setMessage("Narration is required.");
      return;
    }
    if (!postingDate) {
      setStatus("error");
      setMessage("Posting date is required.");
      return;
    }
    if (lines.some((l) => !l.accountCode.trim())) {
      setStatus("error");
      setMessage("All lines must have an account code.");
      return;
    }
    if (!balanced) {
      setStatus("error");
      setMessage(
        `Journal does not balance — Debit ₹${fmt(totalDebitPaise)} vs Credit ₹${fmt(totalCreditPaise)}.`
      );
      return;
    }

    setStatus("submitting");
    setMessage("");

    const body = {
      voucherNo:   voucherNo.trim(),
      type:        "journal" as const,
      postingDate,
      narration:   narration.trim(),
      lines: lines.map((l) => ({
        accountCode:  l.accountCode.trim(),
        debitMinor:   rupeesToPaise(l.debit),
        creditMinor:  rupeesToPaise(l.credit),
      })),
    };

    try {
      const res = await fetch("/api/proxy/v1/finance/journals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await res.text();

      if (res.status === 200 || res.status === 201 || res.status === 202) {
        setStatus("accepted");
        setMessage(
          res.status === 202
            ? "Journal entry accepted for processing (202)."
            : "Journal entry posted successfully."
        );
        /* reset form */
        setVoucherNo("");
        setNarration("");
        setPostingDate(new Date().toISOString().slice(0, 10));
        setLines([emptyLine(defaultDebit), emptyLine(defaultCredit)]);
        return;
      }

      setStatus("error");
      try {
        const json = JSON.parse(text);
        setMessage(json?.message ?? json?.error ?? text ?? `Request failed (${res.status})`);
      } catch {
        setMessage(text || `Request failed (${res.status})`);
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <form className="fields" onSubmit={handlePost}>
      {/* ── header fields ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div className="field">
          <label className="label">Voucher Number</label>
          <input
            className="input"
            placeholder="e.g. JV-2026-001"
            value={voucherNo}
            onChange={(e) => setVoucherNo(e.target.value)}
            aria-label="Voucher Number"
          />
        </div>
        <div className="field">
          <label className="label">Posting Date</label>
          <input
            className="input"
            type="date"
            value={postingDate}
            onChange={(e) => setPostingDate(e.target.value)}
            aria-label="Posting Date"
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Narration</label>
        <input
          className="input"
          placeholder="Brief description of the transaction"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          aria-label="Narration"
        />
      </div>

      {/* ── journal lines ── */}
      <div style={{ marginTop: "16px" }}>
        <label className="label" style={{ marginBottom: "6px", display: "block" }}>
          Journal Lines
        </label>

        {/* header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr auto",
            gap: "8px",
            fontSize: "0.75rem",
            color: "#64748b",
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

        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr auto",
              gap: "8px",
              marginBottom: "6px",
              alignItems: "center",
            }}
          >
            {accounts.length > 0 ? (
              <select
                className="input"
                value={line.accountCode}
                onChange={(e) => updateLine(line.id, "accountCode", e.target.value)}
                aria-label="Account Code"
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
                aria-label="Account Code"
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
              aria-label="Debit amount"
            />
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={line.credit}
              onChange={(e) => updateLine(line.id, "credit", e.target.value)}
              aria-label="Credit amount"
            />
            <button
              type="button"
              onClick={() => removeLine(line.id)}
              disabled={lines.length <= 2}
              style={{
                background: "none",
                border: "none",
                cursor: lines.length <= 2 ? "not-allowed" : "pointer",
                color: lines.length <= 2 ? "#cbd5e1" : "#ef4444",
                fontSize: "1.1rem",
                padding: "0 4px",
              }}
              title="Remove line"
              aria-label="Remove line"
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="btn"
          style={{ marginTop: "4px", fontSize: "0.85rem" }}
        >
          + Add Line
        </button>
      </div>

      {/* ── totals ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr auto",
          gap: "8px",
          marginTop: "8px",
          padding: "8px 0",
          borderTop: "1px solid #e2e8f0",
          fontWeight: 600,
          fontSize: "0.9rem",
        }}
      >
        <span style={{ color: "#475569" }}>Totals</span>
        <span style={{ color: totalDebitPaise > 0 ? "#1e40af" : "#94a3b8" }}>
          ₹{fmt(totalDebitPaise)}
        </span>
        <span style={{ color: totalCreditPaise > 0 ? "#1e40af" : "#94a3b8" }}>
          ₹{fmt(totalCreditPaise)}
        </span>
        <span
          style={{
            fontSize: "0.75rem",
            color: balanced ? "#16a34a" : totalDebitPaise === 0 ? "#94a3b8" : "#dc2626",
            fontWeight: 700,
            alignSelf: "center",
          }}
        >
          {balanced ? "✓" : totalDebitPaise === 0 ? "—" : "✗"}
        </span>
      </div>

      {/* ── actions ── */}
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button
          type="submit"
          disabled={status === "submitting" || !balanced}
          className="btn primary"
          title={!balanced ? "Debit and credit totals must match before posting" : undefined}
        >
          {status === "submitting" ? "Submitting…" : "Post Journal Entry"}
        </button>
      </div>

      {/* ── feedback ── */}
      {message && (
        <p
          role="alert"
          style={{
            fontSize: "0.85rem",
            marginTop: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            background: status === "error" ? "#fef2f2" : "#f0fdf4",
            color: status === "error" ? "#dc2626" : "#16a34a",
            border: `1px solid ${status === "error" ? "#fecaca" : "#bbf7d0"}`,
          }}
        >
          {message}
        </p>
      )}
    </form>
  );
}

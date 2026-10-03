"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import Link from "next/link";
import type { AccountSummary } from "@civitasone/types";
import { formatMoney, todayIST } from "@/lib/formatters";
import { parseMinorOrZero } from "@/lib/money";
import { Button, ConfirmDialog, EmptyState, HelpTip } from "@/app/_components/ds";
import { explain } from "@/lib/glossary";
import { trackActivation } from "@/lib/activation";
import { useFormError } from "@/lib/useFormError";
import { checkPostingDate, type PeriodStatusRow } from "@/lib/finance/periodStatus";

type Props = {
  accounts: AccountSummary[];
  /** Where to go after a successful post (vouchers/new redirects to the GL). */
  redirectTo?: string;
  /**
   * GAP-FINANCE-JOURNAL-ENTRY-03: accounting periods (status per YYYY-MM) for
   * the closed-period check on the posting date. `null` = the list failed to
   * load (status is shown as unverified); omitted = no check is offered.
   */
  periods?: PeriodStatusRow[] | null;
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

/**
 * GAP-FINANCE-JOURNAL-ENTRY-02: amounts are parsed string -> bigint paise with
 * no float maths (lib/money parseMinorOrZero). An unparseable entry (3+
 * decimals, exponent, negative...) is `null`: it is surfaced as a field error
 * and counted as 0 in the running totals so the form can never post a
 * silently-rounded amount.
 */
function paiseOf(val: string): bigint {
  return parseMinorOrZero(val) ?? 0n;
}
/**
 * GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05: conservative, configurable shape for
 * the voucher reference (finance-service accepts 1-64 chars; the gapless
 * number is allocated server-side on approval). Deliberately permissive until
 * Finance fixes a numbering series: letters, digits, space and . / _ -.
 */
export const VOUCHER_NO_MAX = 64;
export const VOUCHER_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/;
export function voucherNoError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Voucher number is required.";
  if (v.length > VOUCHER_NO_MAX) return `Voucher number must be at most ${VOUCHER_NO_MAX} characters.`;
  if (!VOUCHER_NO_PATTERN.test(v)) return "Use letters, numbers and - _ / . only, starting with a letter or number.";
  return null;
}
const AMOUNT_ERROR = "Enter an amount with at most 2 decimals.";
const AMOUNT_COMMA_ERROR = "Enter digits and an optional decimal point only - remove the commas (e.g. 100000.50).";
function amountErrorFor(val: string): string {
  return val.includes(",") ? AMOUNT_COMMA_ERROR : AMOUNT_ERROR;
}

/** Lakh-grouped preview under an amount input (GAP-FINANCE-JOURNAL-ENTRY-02). */
function amountPreview(val: string) {
  const minor = parseMinorOrZero(val);
  if (minor === null) {
    return <span role="alert" style={{ fontSize: "0.7rem", color: "#b91c1c", display: "block" }}>{amountErrorFor(val)}</span>;
  }
  if (minor === 0n) return null;
  return <span style={{ fontSize: "0.7rem", color: "var(--ink2, #475569)", display: "block" }}>= {formatMoney(minor)}</span>;
}

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"] as const;
const TYPE_LABEL: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };

/**
 * GAP-FINANCE-JOURNAL-ENTRY-04: postable accounts grouped by type (assets,
 * liabilities, ...) and narrowed by the text filter. The account already
 * chosen on a line is always kept so a filter never blanks a selection.
 */
export function accountGroups(accounts: AccountSummary[], filter: string, selectedCode: string) {
  const q = filter.trim().toLowerCase();
  const shown = accounts.filter(
    (a) => !q || a.code === selectedCode || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
  );
  const types = [...TYPE_ORDER, ...Array.from(new Set(shown.map((a) => String(a.type)))).filter((t) => !(TYPE_ORDER as readonly string[]).includes(t))];
  return types
    .map((type) => ({ type, label: TYPE_LABEL[type] ?? type, accounts: shown.filter((a) => String(a.type) === type) }))
    .filter((g) => g.accounts.length > 0);
}

type FieldErrors = {
  voucherNo?: string;
  narration?: string;
  postingDate?: string;
  lines?: Record<number, string>;
  balance?: string;
};

export function JournalEntryForm({ accounts: allAccounts, redirectTo, periods }: Props) {
  // GAP-FINANCE-JOURNAL-ENTRY-01: only active, leaf heads are postable. A head
  // that is some other head's parent is a group head, which the GL consumer
  // refuses (DOM-010 NOT_LEAF_ACCOUNT), so it is not offered.
  const groupHeadIds = new Set(allAccounts.map((a) => a.parentId).filter((p): p is string => Boolean(p)));
  // GAP-FINANCE-JOURNAL-ENTRY-04: control accounts (sub-ledger maintained) are not postable from a manual journal.
  const accounts = allAccounts.filter((a) => a.status !== "inactive" && !a.isControl && !(a.id && groupHeadIds.has(a.id)));
  const postableCodes = new Set(accounts.map((a) => a.code));
  // No invented "1000"/"2000" fallbacks: defaults come only from the loaded chart.
  const defaultDebit  = accounts.find((a) => a.type === "asset")?.code     ?? accounts[0]?.code ?? "";
  const defaultCredit = accounts.find((a) => a.type === "liability")?.code ?? accounts[1]?.code ?? "";

  const [voucherNo,  setVoucherNo]  = useState("");
  const [narration,  setNarration]  = useState("");
  const [postingDate, setPostingDate] = useState(() => todayIST());
  const [lines, setLines] = useState<JournalLine[]>([
    emptyLine(defaultDebit),
    emptyLine(defaultCredit),
  ]);
  const [errors, setErrors] = useState<FieldErrors>({});
  // GAP-FINANCE-JOURNAL-ENTRY-04: a long chart of accounts needs a text filter.
  const [accountFilter, setAccountFilter] = useState("");
  const [status,  setStatus]  = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // GAP-FINANCE-VOUCHERS-NEW-02: after a successful post with a redirectTo the
  // clerk stays on a success panel (no instant hard navigation) and chooses
  // between viewing the GL and posting another voucher.
  const [posted, setPosted] = useState<{ voucherNo: string | null; queued: boolean } | null>(null);
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
  const totalDebitPaise  = lines.reduce((s, l) => s + paiseOf(l.debit),  0n);
  const totalCreditPaise = lines.reduce((s, l) => s + paiseOf(l.credit), 0n);
  const diffPaise = totalDebitPaise - totalCreditPaise;
  const balanced = totalDebitPaise > 0n && diffPaise === 0n;

  const dateCheck = periods === undefined ? null : checkPostingDate(postingDate, periods);

  /* ── validation (per-field) ─────────────────────────────────── */
  function validate(): FieldErrors {
    const e: FieldErrors = {};
    // JOURNAL-ENTRY-06: blank is allowed (server allocates); a typed reference must still be well-formed.
    const voucherErr = voucherNo.trim() ? voucherNoError(voucherNo) : null;
    if (voucherErr) e.voucherNo = voucherErr;
    if (!narration.trim()) e.narration = "Narration is required.";
    if (!postingDate) e.postingDate = "Posting date is required.";
    else if (dateCheck?.kind === "hard_close") {
      e.postingDate = `Period ${dateCheck.period} is hard-closed. Choose a date in an open period.`;
    } else if (dateCheck?.kind === "soft_close") {
      // finance-service refuses type "journal" in a soft-closed period (PERIOD_SOFT_CLOSED).
      e.postingDate = `Period ${dateCheck.period} is soft-closed: only adjustment/closing journals are accepted in a soft-closed period. Choose a date in an open period.`;
    }
    const lineErrs: Record<number, string> = {};
    lines.forEach((l) => {
      const debit = parseMinorOrZero(l.debit);
      const credit = parseMinorOrZero(l.credit);
      if (!l.accountCode.trim() || !postableCodes.has(l.accountCode.trim())) lineErrs[l.id] = "Select an account from the list.";
      else if (debit === null || credit === null) lineErrs[l.id] = amountErrorFor(debit === null ? l.debit : l.credit);
      else if (debit > 0n && credit > 0n)
        lineErrs[l.id] = "A line cannot have both a debit and a credit.";
    });
    if (Object.keys(lineErrs).length) e.lines = lineErrs;
    if (!balanced) {
      e.balance =
        totalDebitPaise === 0n
          ? "Enter at least one debit and matching credit."
          : `Debit and credit differ by ${formatMoney(diffPaise < 0n ? -diffPaise : diffPaise)} (debit ${formatMoney(totalDebitPaise)}, credit ${formatMoney(totalCreditPaise)}).`;
    }
    return e;
  }

  /* ── request submit → opens confirm (maker-checker) ─────────── */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      // GAP-FINANCE-JOURNAL-ENTRY-05: when the only problem is the balance, its
      // own alert (below the totals) is the single announcement -- no second
      // generic banner for screen readers to read out.
      const onlyBalance = Object.keys(errs).length === 1 && errs.balance !== undefined;
      setStatus(onlyBalance ? "idle" : "error");
      setMessage(onlyBalance ? "" : "Please correct the highlighted fields before posting.");
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
      // GAP-FINANCE-JOURNAL-ENTRY-06: blank -> "AUTO"; finance-service allocates
      // the gapless number on approval and enforces UNIQUE(tenant_id, voucher_no).
      voucherNo:   voucherNo.trim() || "AUTO",
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
        debitMinor:   paiseOf(l.debit).toString(),
        creditMinor:  paiseOf(l.credit).toString(),
      })),
    };

    const res = await fetch("/api/proxy/v1/finance/journals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });

    if (res.status === 200 || res.status === 201 || res.status === 202) {
      // Read the body once; only use fields that exist -- never invent a journal id.
      await res.json().catch(() => null);
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
        setPosted({ voucherNo: voucherNo.trim() || null, queued: res.status === 202 });
        return;
      }
      /* reset form */
      setVoucherNo("");
      setNarration("");
      setPostingDate(todayIST());
      setLines([emptyLine(defaultDebit), emptyLine(defaultCredit)]);
      setErrors({});
      return;
    }

    const resolved = await formError.fromResponse(res, "save");
    setStatus("error");
    setMessage(resolved.message);
    // Surface the error inside the dialog by throwing for ConfirmDialog's busy/error flow.
    throw UserFacingError.from(resolved);
  }

  const errId = "jv-form-error";

  function postAnother() {
    setPosted(null);
    setStatus("idle");
    setMessage("");
    setVoucherNo("");
    setNarration("");
    setPostingDate(todayIST());
    setLines([emptyLine(defaultDebit), emptyLine(defaultCredit)]);
    setErrors({});
  }

  // GAP-FINANCE-JOURNAL-ENTRY-01 / VOUCHERS-NEW-01: never offer free-text
  // account codes. With no postable heads there is nothing valid to post to.
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="📒"
        title="No accounts configured"
        message="No accounts configured - create accounts in Chart of Accounts first."
        action={<Link href="/finance/chart-of-accounts" className="btn primary">Open Chart of Accounts</Link>}
      />
    );
  }

  if (posted && redirectTo) {
    return (
      <div role="status" aria-live="polite" style={{ padding: "8px 0" }}>
        <p style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 4px", color: "#15803d" }}>
          {posted.queued
            ? "Journal entry accepted for processing (202)."
            : "Journal entry posted successfully."}
        </p>
        <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--ink2, #475569)" }}>
          {posted.voucherNo ? <>Voucher <strong>{posted.voucherNo}</strong></> : "The voucher number is allocated when the entry is approved. The entry"}
          {posted.queued ? " is queued and may take a moment to appear in the General Ledger." : " has been posted."}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            className="btn primary"
            href={`${redirectTo}?${posted.voucherNo ? `posted=${encodeURIComponent(posted.voucherNo)}&` : ""}state=${posted.queued ? "queued" : "posted"}`}
          >
            View in General Ledger
          </Link>
          <Button type="button" onClick={postAnother} style={{ minHeight: 44 }}>Post another</Button>
        </div>
      </div>
    );
  }

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
            placeholder="Leave blank to auto-number"
            maxLength={VOUCHER_NO_MAX}
            value={voucherNo}
            onChange={(e) => setVoucherNo(e.target.value)}
            aria-invalid={errors.voucherNo ? true : undefined}
            aria-describedby={errors.voucherNo ? "jv-voucher-err" : undefined}
          />
          <span style={{ fontSize: "0.7rem", color: "var(--ink2, #475569)", display: "block", marginTop: 2 }}>
            Optional. If left blank, a gapless voucher number is allocated when the entry is approved.
          </span>
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
          {dateCheck && !errors.postingDate && (
            <span
              role="status"
              style={{
                fontSize: "0.75rem", marginTop: 2, display: "block", fontWeight: 600,
                color: dateCheck.kind === "open" ? "#15803d" : dateCheck.kind === "hard_close" || dateCheck.kind === "soft_close" ? "#b91c1c" : "#b45309",
              }}
            >
              {dateCheck.kind === "open" && `Period ${dateCheck.period} is open.`}
              {dateCheck.kind === "soft_close" && `Period ${dateCheck.period} is soft-closed: only adjustment/closing journals are accepted in a soft-closed period.`}
              {dateCheck.kind === "hard_close" && `Period ${dateCheck.period} is hard-closed and cannot take postings.`}
              {dateCheck.kind === "unknown" && `No period record found for ${dateCheck.period}; its status is unverified.`}
              {dateCheck.kind === "unverified" && `Closed-period status could not be loaded, so ${dateCheck.period} is unverified. The server still blocks closed periods.`}
            </span>
          )}
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

        <div className="field" style={{ marginBottom: 8 }}>
          <label className="label" htmlFor="jv-account-filter">Filter accounts</label>
          <input
            id="jv-account-filter"
            className="input"
            type="search"
            placeholder="Type a code or name, e.g. cash"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
          />
        </div>

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
            <select
              className="input"
              value={line.accountCode}
              onChange={(e) => updateLine(line.id, "accountCode", e.target.value)}
              aria-label={`Account code, line ${idx + 1}`}
              aria-invalid={lineErr ? true : undefined}
            >
              <option value="">— select account —</option>
              {accountGroups(accounts, accountFilter, line.accountCode).map((g) => (
                <optgroup key={g.type} label={g.label}>
                  {g.accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={line.debit}
                onChange={(e) => updateLine(line.id, "debit", e.target.value)}
                aria-label={`Debit amount, line ${idx + 1}`}
                aria-invalid={parseMinorOrZero(line.debit) === null ? true : undefined}
              />
              {amountPreview(line.debit)}
            </div>
            <div>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={line.credit}
                onChange={(e) => updateLine(line.id, "credit", e.target.value)}
                aria-label={`Credit amount, line ${idx + 1}`}
                aria-invalid={parseMinorOrZero(line.credit) === null ? true : undefined}
              />
              {amountPreview(line.credit)}
            </div>
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
        <span className="num" style={{ color: totalDebitPaise > 0n ? "var(--primary-d, #1e40af)" : "var(--ink2)" }}>
          {formatMoney(totalDebitPaise)}
        </span>
        <span className="num" style={{ color: totalCreditPaise > 0n ? "var(--primary-d, #1e40af)" : "var(--ink2)" }}>
          {formatMoney(totalCreditPaise)}
        </span>
        <span
          role="status"
          aria-live="polite"
          style={{
            fontSize: "0.78rem",
            color: balanced ? "#15803d" : totalDebitPaise === 0n ? "#64748b" : "#b91c1c",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {balanced ? (
            <><span aria-hidden="true">✓ </span>Balanced</>
          ) : totalDebitPaise === 0n ? (
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

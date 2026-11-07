"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AccountSummary } from "@civitasone/types";
import { formatMoney, todayIST } from "@/lib/formatters";
import { parseMinorOrZero } from "@/lib/money";
import { Alert, Button, ConfirmDialog, DateInput, EmptyState, Field, HelpTip, Input, RequiredLegend, Textarea } from "@/app/_components/ds";
import { AccountCombobox } from "./AccountCombobox";
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
    return <span role="alert" style={{ fontSize: "0.7rem", color: "var(--bad)", display: "block" }}>{amountErrorFor(val)}</span>;
  }
  if (minor === 0n) return null;
  return <span style={{ fontSize: "0.7rem", color: "var(--ink2)", display: "block" }}>= {formatMoney(minor)}</span>;
}

// GAP-FINANCE-JOURNAL-ENTRY-04: grouping/filtering now lives with the searchable head-of-account combobox.
export { accountGroups } from "./AccountCombobox";

/**
 * UX-R2: the live difference and the reason Post is disabled. `diffPaise` = debit - credit.
 * "Difference ₹5,000.00 Dr" means debit is ahead (a credit is missing), "Cr" the reverse.
 */
export function balanceStatus(totalDebitPaise: bigint, totalCreditPaise: bigint): { balanced: boolean; difference: string | null; reason: string | null } {
  const diff = totalDebitPaise - totalCreditPaise;
  if (totalDebitPaise > 0n && diff === 0n) return { balanced: true, difference: null, reason: null };
  if (totalDebitPaise === 0n && totalCreditPaise === 0n) {
    return { balanced: false, difference: null, reason: "Enter the debit and credit amounts. Debit and credit must be equal before you can submit." };
  }
  if (diff === 0n) {
    return { balanced: false, difference: null, reason: "Enter at least one debit and matching credit before you can submit." };
  }
  const abs = diff < 0n ? -diff : diff;
  const side = diff > 0n ? "Dr" : "Cr";
  const fix = diff > 0n ? `Add a credit of ${formatMoney(abs)}` : `Add a debit of ${formatMoney(abs)}`;
  return { balanced: false, difference: `${formatMoney(abs)} ${side}`, reason: `Debit and credit must be equal before you can submit. ${fix} or correct an amount.` };
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
  const [status,  setStatus]  = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // GAP-FINANCE-JOURNAL-ENTRY-06 / VOUCHERS-NEW-05/06: the id of the input to focus once a server refusal tied to that field
  // closes the confirm dialog. Focus cannot move in the same tick as the close: the page behind an open Modal is `inert`
  // (a browser ignores focus() on it) and Modal restores focus to the button that opened it when it unmounts. This effect
  // runs after both of those are undone.
  const focusAfterClose = useRef<string | null>(null);
  useEffect(() => {
    if (confirmOpen || !focusAfterClose.current) return;
    const id = focusAfterClose.current;
    focusAfterClose.current = null;
    document.getElementById(id)?.focus();
  }, [confirmOpen]);
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
  const balanceInfo = balanceStatus(totalDebitPaise, totalCreditPaise);

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
    // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05 / -06 and GAP-FINANCE-JOURNAL-ENTRY-06: a refusal tied to a field of THIS
    // form (the voucher number is already used, the posting date is in a closed period) is fixed in that field. Close
    // the confirm dialog so the message under the field is visible, keep everything the officer typed, and move focus
    // there once the dialog is gone (see focusAfterClose). Nothing was queued or posted (the server refuses before
    // enqueueing), so there is no redirect and no success panel, and the same idempotency key is safe to reuse for the
    // corrected submit.
    const fieldToFix = resolved.fieldErrors.voucherNo ? "jv-voucher" : resolved.fieldErrors.postingDate ? "jv-date" : null;
    if (fieldToFix) {
      focusAfterClose.current = fieldToFix;
      setConfirmOpen(false);
      return;
    }
    // Any other failure is shown inside the dialog by throwing for ConfirmDialog's busy/error flow.
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
        <p style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 4px", color: "var(--good)" }}>
          {posted.queued
            ? "Journal entry accepted for processing (202)."
            : "Journal entry posted successfully."}
        </p>
        <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--ink2)" }}>
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
  const voucherErr = errors.voucherNo ?? formError.fieldError("voucherNo") ?? undefined;
  const dateErr = errors.postingDate ?? formError.fieldError("postingDate") ?? undefined;
  const narrationErr = errors.narration ?? formError.fieldError("narration") ?? undefined;
  const lineCols = "32px minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) 44px";
  return (
    <form className="fields jv-form" onSubmit={handleSubmit} noValidate aria-describedby={message ? errId : undefined}>
      <RequiredLegend />
      {/* ── header fields (UX-R2: fits 1366 px; narration is the widest field, on its own row) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "12px 16px" }}>
        <Field
          id="jv-voucher"
          className="field"
          label={<>Voucher Number<HelpTip term="Voucher">{explain("Voucher")}</HelpTip></>}
          hint="Optional. If left blank, a gapless voucher number is allocated when the entry is approved."
          error={voucherErr}
          validate={(v) => (v.trim() ? voucherNoError(v) ?? undefined : undefined)}
        >
          <Input placeholder="Leave blank to auto-number" maxLength={VOUCHER_NO_MAX} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} />
        </Field>
        <Field id="jv-date" className="field" label="Posting Date" required hint="DD-MM-YYYY" error={dateErr}>
          <DateInput value={postingDate} onChange={setPostingDate} />
          {dateCheck && !dateErr && (
            <span
              role="status"
              style={{
                fontSize: "0.75rem", marginTop: 2, display: "block", fontWeight: 600,
                color: dateCheck.kind === "open" ? "var(--good)" : dateCheck.kind === "hard_close" || dateCheck.kind === "soft_close" ? "var(--bad)" : "var(--warn)",
              }}
            >
              {dateCheck.kind === "open" && `Period ${dateCheck.period} is open.`}
              {dateCheck.kind === "soft_close" && `Period ${dateCheck.period} is soft-closed: only adjustment/closing journals are accepted in a soft-closed period.`}
              {dateCheck.kind === "hard_close" && `Period ${dateCheck.period} is hard-closed and cannot take postings.`}
              {dateCheck.kind === "unknown" && `No period record found for ${dateCheck.period}; its status is unverified.`}
              {dateCheck.kind === "unverified" && `Closed-period status could not be loaded, so ${dateCheck.period} is unverified. The server still blocks closed periods.`}
            </span>
          )}
        </Field>
        <Field
          id="jv-narration"
          className="field"
          label="Narration"
          required
          requiredMessage="Narration is required."
          hint="Appears on the ledger and in the voucher print."
          error={narrationErr}
          style={{ gridColumn: "1 / -1" }}
        >
          <Textarea rows={2} placeholder="Brief description of the transaction" value={narration} onChange={(e) => setNarration(e.target.value)} />
        </Field>
      </div>

      {/* ── journal lines ── */}
      <fieldset style={{ marginTop: "16px", border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="label" style={{ marginBottom: "6px", padding: 0, fontWeight: 600 }}>
          Journal Lines
          <HelpTip term="Double-entry">
            Every entry has two sides — money going out (debit) and money coming in (credit). The two sides must add up to the same total before you can post.
          </HelpTip>
        </legend>

        {/* header row */}
        <div
          aria-hidden="true"
          style={{
            display: "grid", gridTemplateColumns: lineCols, gap: "8px", fontSize: "0.75rem", color: "var(--ink2)",
            fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px",
          }}
        >
          <span>#</span>
          <span>Head of account (code · name)</span>
          <span style={{ textAlign: "right" }}>Debit (₹)</span>
          <span style={{ textAlign: "right" }}>Credit (₹)</span>
          <span />
        </div>

        {lines.map((line, idx) => {
          const lineErr = errors.lines?.[line.id];
          const lineErrId = `jv-line-${line.id}-err`;
          return (
          <div
            key={line.id}
            style={{ display: "grid", gridTemplateColumns: lineCols, gap: "8px", marginBottom: lineErr ? "2px" : "6px", alignItems: "start" }}
          >
            <span style={{ paddingTop: 12, fontSize: 13, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{idx + 1}</span>
            <AccountCombobox
              id={`jv-account-${line.id}`}
              accounts={accounts}
              value={line.accountCode}
              onChange={(code) => updateLine(line.id, "accountCode", code)}
              aria-label={`Head of account, line ${idx + 1}`}
              invalid={Boolean(lineErr)}
              describedBy={lineErr ? lineErrId : undefined}
            />
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
                style={{ textAlign: "right", width: "100%", boxSizing: "border-box" }}
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
                style={{ textAlign: "right", width: "100%", boxSizing: "border-box" }}
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
              <span id={lineErrId} role="alert" style={{ fontSize: "0.75rem", color: "var(--bad)", display: "block", gridColumn: "2 / -1", marginBottom: 4 }}>
                {lineErr}
              </span>
            )}
          </div>
        );})}

        <Button type="button" onClick={addLine} style={{ marginTop: "4px", minHeight: 44 }}>
          + Add Line
        </Button>
      </fieldset>

      {/* ── sticky totals bar (UX-R2): totals, live difference, and the one action with its reason ── */}
      <div
        data-jv-totals=""
        style={{
          position: "sticky", bottom: 0, zIndex: 5, background: "var(--panel)",
          borderTop: "1px solid var(--line2, var(--line))", marginTop: 8, padding: "10px 0",
          display: "grid", gap: 6,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: lineCols, gap: "8px", alignItems: "center", fontWeight: 600, fontSize: "0.9rem" }}>
          <span />
          <span style={{ color: "var(--ink2)" }}>Totals</span>
          {/* Zero-total color: var(--ink2) keeps >= 4.5:1 on this bar (UX-005 tranche 5). */}
          <span className="num" style={{ textAlign: "right", color: totalDebitPaise > 0n ? "var(--primary-d)" : "var(--ink2)" }}>
            {formatMoney(totalDebitPaise)}
          </span>
          <span className="num" style={{ textAlign: "right", color: totalCreditPaise > 0n ? "var(--primary-d)" : "var(--ink2)" }}>
            {formatMoney(totalCreditPaise)}
          </span>
          <span />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", justifyContent: "space-between" }}>
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: "0.85rem",
              color: balanced ? "var(--good)" : totalDebitPaise === 0n && totalCreditPaise === 0n ? "var(--ink2)" : "var(--bad)",
              fontWeight: 700,
            }}
          >
            {balanced ? (
              <><span aria-hidden="true">✓ </span>Balanced</>
            ) : balanceInfo.difference ? (
              <><span aria-hidden="true">✗ </span>Out of balance · Difference <span data-jv-difference="">{balanceInfo.difference}</span></>
            ) : (
              "Not started"
            )}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {balanceInfo.reason ? (
              <span id="jv-submit-reason" style={{ fontSize: "0.8rem", color: "var(--ink2)", maxWidth: 520 }}>{balanceInfo.reason}</span>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              disabled={status === "submitting" || !balanced}
              aria-describedby={balanceInfo.reason ? "jv-submit-reason" : undefined}
              style={{ minHeight: 44 }}
            >
              {status === "submitting" ? "Submitting…" : "Post Journal Entry"}
            </Button>
          </span>
        </div>
      </div>

      {errors.balance && <p role="alert" style={{ fontSize: "0.75rem", color: "var(--bad)", display: "block", marginTop: 4 }}>{errors.balance}</p>}

      {/* ── feedback ── */}
      {message && (
        <Alert
          id={errId}
          variant={status === "error" ? "danger" : "success"}
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{ marginTop: 10, marginBottom: 0 }}
        >
          {message}
        </Alert>
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

"use client";
/**
 * ProbationConfirmationCard / ProbationConfirmationList — Sprint 14 / Lifecycle Phase 2
 * Card grid for employees due for confirmation after 2-year probation (CCS Rules).
 * Each card: probation start, due date, manager recommendation badge, Confirm/Extend buttons.
 *
 * "Confirm" calls the real PATCH /v1/hrms/employees/:id/confirm. "Extend" now
 * calls the real PATCH /v1/hrms/employees/:id/probation-extension
 * (GAP-HR-CONFIRMATION-05) -- previously there was no backend endpoint at
 * all for it, so it stayed disabled with an honest tooltip rather than
 * faking a local state change, which is what this file used to do for BOTH
 * actions ("Optimistic local UI — no API mutation" — clicking "Confirm"
 * showed a checkmark and persisted nothing; a refresh silently reverted
 * it).
 */
import { UserFacingError } from "@/lib/userFacingError";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StatusPill, ConfirmDialog, useConfirmAction, Button, Field, Input, Select } from "@/app/_components/ds";
import { validateConfirm, validateExtend } from "./probationSchema";
import { translateFormErrors } from "../../_components/translateFormErrors";
import { formatIndianDate, daysUntilIST } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

export type ConfirmationRow = {
  id: string;
  employee: string;
  department?: string;
  designation?: string;
  joiningDate: string;
  probationEnd: string;
  dueDate: string;
  managerRecommendation?: "recommended" | "not_recommended" | "pending" | null;
  status: string;
} & Record<string, unknown>;

type LocalAction = "default" | "confirmed" | "extended";

function dueMeta(days: number): { label: string; color: string } {
  if (days < 0)   return { label: `${Math.abs(days)}d overdue`, color: "var(--bad)" };
  if (days === 0) return { label: "Due today",                  color: "var(--bad)" };
  if (days <= 7)  return { label: `Due in ${days}d`,            color: "var(--warn)" };
  if (days <= 30) return { label: `Due in ${days}d`,            color: "var(--warn)" };
  return { label: `Due in ${days}d`,                            color: "var(--info)" };
}

const REC_CONFIG: Record<string, { label: string; badge: string; color: string; bg: string }> = {
  recommended:     { label: "Recommended",      badge: "👍", color: "var(--good)", bg: "var(--goodbg)" },
  not_recommended: { label: "Not Recommended",  badge: "👎", color: "var(--bad)", bg: "var(--badbg)" },
  pending:         { label: "Awaiting Manager", badge: "⏳", color: "var(--warn)", bg: "var(--warnbg)" },
};

// GAP-HR-CONFIRMATION-01 (interim, pending an owner decision): hrms-service has
// no manager-recommendation store or endpoint yet (who records it, and whether
// Confirm is blocked without it, is an undecided policy -- see
// docs/gap-ledger/hr.md), so GET /v1/hrms/confirmations never sends
// `managerRecommendation`. The card used to default that absence to "pending",
// i.e. it told every HR user a manager was "Awaiting" a recommendation nobody
// has any way to give. An ABSENT value is now shown as what it is -- no
// recommendation on record -- and only an explicit "pending" from the API reads
// "Awaiting Manager". Confirm/Extend are unchanged (not gated on it).
const REC_NOT_RECORDED = { badge: "—", color: "var(--mut)", bg: "var(--bg)" };

// GAP-HR-CONFIRMATION-02: today's date in IST, for the confirmation-date
// input's default and its upper bound (a confirmation cannot be postdated
// into the future).
function todayIsoIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function ProbationCard({ row }: { row: ConfirmationRow }) {
  const [action, setAction] = useState<LocalAction>("default");
  const router = useRouter();
  const tv = useTranslations("hrFormErrors");
  const tc = useTranslations("confirmation");
  const days = daysUntilIST(row.dueDate);
  const due  = days !== null ? dueMeta(days) : { label: "Date not set", color: "var(--mut)" };
  const known = row.managerRecommendation ? REC_CONFIG[row.managerRecommendation] : undefined;
  const rec  = known ?? { ...REC_NOT_RECORDED, label: tc("recNotRecorded") };
  const confirmFormError = useFormError("probation confirmation");
  const extendFormError = useFormError("probation extension");

  // GAP-HR-CONFIRMATION-02: orderRef is a required, real order/authority
  // reference (a confirmation is a formal service-record event, not just a
  // click) and confirmationDate is now a controlled, bounded date input
  // (default today IST) instead of an implicit "now". Remark stays optional,
  // carried through ConfirmDialog's own built-in reason field below.
  const [confirmDate, setConfirmDate] = useState(todayIsoIST());
  const [orderRef, setOrderRef] = useState("");
  // Inline field errors only appear after the first confirm/extend attempt.
  const [confirmTried, setConfirmTried] = useState(false);
  const [extendTried, setExtendTried] = useState(false);
  const confirmErrs = confirmTried ? translateFormErrors(validateConfirm({ confirmationDate: confirmDate, orderRef }), tv) : {};

  const {
    open: confirmOpen, busy: confirmBusy, error: confirmError,
    trigger: triggerConfirm, cancel: cancelConfirm, confirm: doConfirm,
  } = useConfirmAction({
    onConfirm: async (remark) => {
      setConfirmTried(true);
      if (!orderRef.trim()) throw new Error("Order reference is required.");
      const schemaErrs = translateFormErrors(validateConfirm({ confirmationDate: confirmDate, orderRef }), tv);
      if (schemaErrs.orderRef || schemaErrs.confirmationDate) throw new Error((schemaErrs.orderRef ?? schemaErrs.confirmationDate) as string);
      const res = await fetch(`/api/proxy/v1/hrms/employees/${row.id}/confirm`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmationDate: confirmDate,
          orderRef: orderRef.trim(),
          remark: remark?.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await confirmFormError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
    },
    // GAP-HR-CONFIRMATION-04: this only means "the command was accepted",
    // not "confirmed" -- the actual write happens async in the consumer.
    // Re-fetch the list so the card reflects the server's real state instead
    // of an optimistic label that would silently revert on the next refresh
    // if the consumer ever rejected it (e.g. a concurrent status change).
    onSuccess: () => {
      setAction("confirmed");
      router.refresh();
    },
  });

  // GAP-HR-CONFIRMATION-05: probation extension, same shape as Confirm above
  // -- newEndDate (bounded: must move the date later than the current
  // probationEnd) and an optional order reference as controlled inputs;
  // reason is required and carried through ConfirmDialog's built-in field.
  const [newEndDate, setNewEndDate] = useState(row.probationEnd && row.probationEnd !== "—" ? row.probationEnd : todayIsoIST());
  const [extendOrderRef, setExtendOrderRef] = useState("");
  const extendErrs = extendTried ? translateFormErrors(validateExtend({ newEndDate, orderRef: extendOrderRef }), tv) : {};

  const {
    open: extendOpen, busy: extendBusy, error: extendError,
    trigger: triggerExtend, cancel: cancelExtend, confirm: doExtend,
  } = useConfirmAction({
    onConfirm: async (reason) => {
      setExtendTried(true);
      {
        const schemaErrs = translateFormErrors(validateExtend({ newEndDate, orderRef: extendOrderRef }), tv);
        if (schemaErrs.newEndDate || schemaErrs.orderRef) throw new Error((schemaErrs.newEndDate ?? schemaErrs.orderRef) as string);
      }
      if (row.probationEnd && row.probationEnd !== "—" && newEndDate <= row.probationEnd) {
        throw new Error(`New end date must be after the current probation end (${formatIndianDate(row.probationEnd)}).`);
      }
      const res = await fetch(`/api/proxy/v1/hrms/employees/${row.id}/probation-extension`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          newEndDate,
          reason: reason?.trim(),
          orderRef: extendOrderRef.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await extendFormError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
    },
    onSuccess: () => {
      setAction("extended");
      router.refresh();
    },
  });

  // SEC CRITICAL (status-integrity fix): this used to be a deny-list
  // (row.status !== "confirmed" && row.status !== "extended") that let the
  // Confirm button show up for a terminated/separated/retired employee too
  // (neither string excludes them) — clicking it hit the now-corrected
  // backend precondition and got a 409, but the button itself should never
  // have been actionable in the first place. Match the backend exactly
  // (employee/routes.ts's PATCH .../confirm — "probation" is the only status
  // confirmation is ever valid from) with an allow-list instead: strictly
  // safer than enumerating every status that should be excluded, and it
  // already covers "extended" too (not a real backend status — see file
  // header comment — so it could never equal row.status anyway).
  const isActionable =
    action === "default" &&
    row.status === "probation";

  return (
    <article
      className="card"
      style={{
        marginBottom: 0,
        borderInlineStart: `4px solid ${days == null ? "var(--line)" : days < 0 ? "var(--bad)" : days <= 14 ? "var(--amber)" : "var(--line)"}`,
      }}
      aria-label={`Probation confirmation for ${row.employee}`}
    >
      {/* Header */}
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div
          aria-hidden="true"
          style={{
            width: 40, height: 40, borderRadius: "50%", background: "var(--infobg)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}
        >
          👤
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>
            {row.employee}
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {row.designation ?? "—"}
            {row.department ? ` · ${row.department}` : ""}
          </p>
        </div>
        {action !== "default" ? (
          <span
            role="status"
            style={{
              padding: "3px 12px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 600,
              background: action === "confirmed" ? "var(--goodbg)" : "var(--warnbg)",
              color:      action === "confirmed" ? "var(--good)" : "var(--warn)",
            }}
          >
            <span aria-hidden="true">{action === "confirmed" ? "✅" : "🔄"}</span>{" "}
            {action === "confirmed" ? "Confirmation submitted" : "Extension submitted"}
          </span>
        ) : (
          <StatusPill status={row.status} />
        )}
      </div>

      {/* Key dates */}
      <dl
        style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px", margin: "12px 16px 0", padding: 0,
          fontSize: "0.8125rem",
        }}
      >
        <div>
          <dt style={{ color: "var(--mut)", marginBottom: 2 }}>Probation Start</dt>
          <dd style={{ margin: 0, fontWeight: 500 }}>{formatIndianDate(row.joiningDate)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--mut)", marginBottom: 2 }}>Probation End</dt>
          <dd style={{ margin: 0, fontWeight: 500 }}>{formatIndianDate(row.probationEnd)}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--mut)", marginBottom: 2 }}>Confirmation Due</dt>
          <dd style={{ margin: 0, fontWeight: 600, color: due.color }}>
            {formatIndianDate(row.dueDate)}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--mut)", marginBottom: 2 }}>Deadline</dt>
          <dd style={{ margin: 0, fontWeight: 600, color: due.color }}>{due.label}</dd>
        </div>
      </dl>

      {/* Manager recommendation + action buttons */}
      <div
        style={{
          padding: "10px 16px 14px", marginTop: 12,
          borderTop: "1px solid var(--line)",
          display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 10, flexWrap: "wrap",
        }}
      >
        <div
          role="status"
          aria-label={tc("recAria", { label: rec.label })}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "5px 12px", borderRadius: 20,
            background: rec.bg, color: rec.color,
            fontSize: "0.8125rem", fontWeight: 500,
          }}
        >
          <span aria-hidden="true">{rec.badge}</span>
          <span>{rec.label}</span>
        </div>

        {isActionable && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setConfirmTried(false); triggerConfirm(); }}
              aria-label={`Confirm ${row.employee}`}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setExtendTried(false); triggerExtend(); }}
              aria-label={`Extend probation for ${row.employee}`}
            >
              Extend
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title={`Confirm ${row.employee}'s service?`}
          description={
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0 }}>
                This ends the probation period and marks the employee&apos;s service as
                confirmed, per CCS Conduct Rules. This is a formal service-record action
                and cannot be undone from here.
              </p>
              <Field label="Confirmation date" required error={confirmErrs.confirmationDate}>
                <Input
                  type="date"
                  value={confirmDate}
                  max={todayIsoIST()}
                  min={row.joiningDate && row.joiningDate !== "—" ? row.joiningDate : undefined}
                  onChange={(e) => setConfirmDate(e.target.value)}
                />
              </Field>
              <Field label="Order reference" required error={confirmErrs.orderRef}>
                <Input
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                  placeholder="e.g. CONFIRM/2026/014"
                />
              </Field>
            </div>
          }
          confirmLabel="Confirm service"
          requireReason
          reasonLabel="Remark (optional)"
          minReasonLength={0}
          maxReasonLength={500}
          busy={confirmBusy}
          errorMessage={confirmError}
          onConfirm={(remark) => void doConfirm(remark)}
          onCancel={cancelConfirm}
        />

        <ConfirmDialog
          open={extendOpen}
          title={`Extend probation for ${row.employee}?`}
          description={
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0 }}>
                Current probation end: <strong>{formatIndianDate(row.probationEnd)}</strong>.
                Choose the new end date and record why.
              </p>
              <Field label="New probation end date" required error={extendErrs.newEndDate}>
                <Input
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                />
              </Field>
              <Field label="Order reference (optional)" error={extendErrs.orderRef}>
                <Input
                  value={extendOrderRef}
                  onChange={(e) => setExtendOrderRef(e.target.value)}
                  placeholder="e.g. EXT/2026/003"
                />
              </Field>
            </div>
          }
          confirmLabel="Extend probation"
          requireReason
          reasonLabel="Reason"
          minReasonLength={3}
          maxReasonLength={500}
          busy={extendBusy}
          errorMessage={extendError}
          onConfirm={(reason) => void doExtend(reason)}
          onCancel={cancelExtend}
        />
      </div>
    </article>
  );
}

type Bucket = "all" | "overdue" | "due_soon" | "timely" | "not_set";

interface ListProps {
  rows: ConfirmationRow[];
  /** GAP-HR-CONFIRMATION-07: the API caps at 500 rows; surface truncation honestly instead of silently dropping the rest. */
  hasMore?: boolean;
}

// GAP-HR-CONFIRMATION-07: sort/filter -- with up to 500 cards, the most
// overdue ones need to float to the top rather than relying on API order
// (joining date), which is only a proxy for due date and is wrong whenever
// confirmationDate overrides it.
export function ProbationConfirmationList({ rows, hasMore }: ListProps) {
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<Bucket>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (q && !`${r.employee} ${r.department ?? ""}`.toLowerCase().includes(q)) return false;
        const days = daysUntilIST(r.dueDate);
        if (bucket === "all") return true;
        if (bucket === "not_set") return days === null;
        if (days === null) return false;
        if (bucket === "overdue") return days < 0;
        if (bucket === "due_soon") return days >= 0 && days <= 30;
        if (bucket === "timely") return days > 30;
        return true;
      })
      .sort((a, b) => {
        const da = daysUntilIST(a.dueDate);
        const db = daysUntilIST(b.dueDate);
        if (da === null && db === null) return 0;
        if (da === null) return 1;  // nulls (date not set) sort last
        if (db === null) return -1;
        return da - db; // most overdue (most negative) first
      });
  }, [rows, search, bucket]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--mut)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">✅</div>
        <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 500 }}>
          No employees currently on probation
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "0.8125rem" }}>
          Employees in their 2-year probation period appear here once added to the service book.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by employee or department…"
          aria-label="Search by employee or department"
          style={{ flex: "1 1 220px", width: "auto" }}
        />
        <Select
          value={bucket}
          onChange={(e) => setBucket(e.target.value as Bucket)}
          aria-label="Filter by deadline"
          style={{ width: "auto" }}
        >
          <option value="all">All</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due in 30 days</option>
          <option value="timely">Timely</option>
          <option value="not_set">Date not set</option>
        </Select>
      </div>

      {hasMore && (
        <p style={{ margin: "0 0 14px", fontSize: "0.8125rem", color: "var(--warn)" }}>
          Showing the first 500 probationers. Refine your search to find someone not listed here.
        </p>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--mut)", fontSize: "0.875rem" }}>
          No probationers match this filter.
        </div>
      ) : (
        <div
          style={{
            display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
          }}
        >
          {filtered.map((row) => (
            <ProbationCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

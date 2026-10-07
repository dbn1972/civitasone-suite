"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader, Card, Button, ConfirmDialog } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface, #fff)",
  color: "var(--ink)",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

/**
 * GAP-WORKS-BILLING-ACCOUNT-COMPILE-04: government financial year runs
 * April → March, so the month select is ordered FY-first (April first). Each
 * option still carries its CALENDAR month number as its value, so the payload
 * is unchanged ({ month: 1..12, year }). The label shows the FY the month
 * belongs to for the chosen year.
 */
const MONTHS_FY: { value: number; name: string }[] = [
  { value: 4, name: "April" },
  { value: 5, name: "May" },
  { value: 6, name: "June" },
  { value: 7, name: "July" },
  { value: 8, name: "August" },
  { value: 9, name: "September" },
  { value: 10, name: "October" },
  { value: 11, name: "November" },
  { value: 12, name: "December" },
  { value: 1, name: "January" },
  { value: 2, name: "February" },
  { value: 3, name: "March" },
];

/** FY label for a calendar month+year, e.g. Jan 2027 → "FY 2026-27". */
function fyLabel(month: number, year: number): string {
  const startYear = month >= 4 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY ${startYear}-${endShort}`;
}

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - i);

type PriorCompile = { id: string; status: string; submittedTo: string | null; submittedAt: string | null };

export default function AccountCompilePage() {
  const { toast } = useToast();

  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(currentYear));
  const [submittedTo, setSubmittedTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [prior, setPrior] = useState<PriorCompile[]>([]);
  const formError = useFormError("account compile");

  // GAP-WORKS-BILLING-ACCOUNT-COMPILE-03: check whether the chosen month/year
  // was already compiled, so the clerk is warned before a duplicate treasury
  // submission (which must then be an explicit, informed confirm).
  const checkPrior = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/proxy/v1/works/billing/account-compile?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`,
      );
      if (!res.ok) {
        setPrior([]);
        return;
      }
      const body = (await res.json()) as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data : [];
      setPrior(
        rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id ?? ""),
            status: String(row.status ?? ""),
            submittedTo: row.submittedTo == null ? null : String(row.submittedTo),
            submittedAt: row.submittedAt == null ? null : String(row.submittedAt),
          };
        }),
      );
    } catch {
      setPrior([]);
    }
  }, [month, year]);

  useEffect(() => {
    if (!done) void checkPrior();
  }, [checkPrior, done]);

  const alreadyCompiled = prior.length > 0;

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    formError.clear();
    if (!submittedTo.trim()) {
      setError("Submitted To is required.");
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setError(null);
    formError.clear();
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/works/billing/account-compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: parseInt(month, 10),
          year: parseInt(year, 10),
          submittedTo: submittedTo.trim(),
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }

      // GAP-WORKS-BILLING-ACCOUNT-COMPILE-01: surface the job reference the
      // backend returns. The async-write envelope is
      // { id, status:"accepted", correlationId, data?:{id} } (acceptedResponseSchema),
      // so the id/correlationId are TOP-LEVEL; read those first, nested data.id last.
      let ref: string | null = null;
      try {
        const body = (await res.json()) as {
          id?: string;
          correlationId?: string;
          data?: { id?: string };
        };
        ref = body?.id ?? body?.data?.id ?? body?.correlationId ?? null;
      } catch {
        ref = null;
      }
      setReference(ref);
      setConfirmOpen(false);
      setDone(true);
      toast.success("Account compile initiated.");
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);
  const selectedMonthName = MONTHS_FY.find((m) => m.value === monthNum)?.name ?? month;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Account Compile"
        subtitle="Compile and submit the monthly account statement to treasury."
        back="/works/billing"
        backLabel="Billing Register"
      />

      <Card style={{ maxWidth: 560, padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {done ? (
          <div
            role="status"
            style={{
              background: "#ecfdf3",
              color: "#166534",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span>✅ Account compile submitted for {selectedMonthName} {year} ({fyLabel(monthNum, yearNum)}).</span>
            {reference ? (
              <span style={{ fontWeight: 400 }}>
                Reference: <code>{reference}</code>
              </span>
            ) : null}
            <Link href="/works/billing" className="btn ghost" style={{ alignSelf: "flex-start", minHeight: 36 }}>
              Go to billing
            </Link>
          </div>
        ) : null}

        {error && (
          <div
            role="alert"
            style={{
              background: "#fef2f2",
              color: "#b42318",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {!done && alreadyCompiled && (
          <div
            role="status"
            style={{
              background: "#fffaeb",
              color: "#92400e",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            ⚠️ {selectedMonthName} {year} ({fyLabel(monthNum, yearNum)}) has already been compiled
            {prior[0]?.submittedTo ? ` (submitted to ${prior[0].submittedTo})` : ""}. Re-running will
            submit again to treasury — confirm only if you intend a re-submission.
          </div>
        )}

        {!done && (
          <form onSubmit={openConfirm} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
              This action is restricted to DAO / DO roles. The compile job runs
              asynchronously and generates the monthly expenditure statement.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={labelStyle} htmlFor="month">
                  Month <span style={{ color: "#b42318" }}>*</span>
                </label>
                <select
                  id="month"
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  required
                >
                  {MONTHS_FY.map((m) => (
                    <option key={m.value} value={String(m.value)}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle} htmlFor="year">
                  Year <span style={{ color: "#b42318" }}>*</span>
                </label>
                <select
                  id="year"
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  required
                >
                  {YEARS.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
              Statement period: {selectedMonthName} {year} ({fyLabel(monthNum, yearNum)}).
            </p>

            <div>
              <label style={labelStyle} htmlFor="submittedTo">
                Submitted To <span style={{ color: "#b42318" }}>*</span>
              </label>
              <input
                id="submittedTo"
                type="text"
                style={inputStyle}
                value={submittedTo}
                onChange={(e) => setSubmittedTo(e.target.value)}
                placeholder="Office or person receiving the compiled account"
                maxLength={256}
                required
              />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                E.g. &quot;Treasury Officer, Bhubaneswar&quot;
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", paddingTop: 4 }}>
              <Link
                href="/works/billing"
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                Cancel
              </Link>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Submitting…" : "Compile Account"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* GAP-WORKS-BILLING-ACCOUNT-COMPILE-01: an explicit confirm before an
          irreversible treasury submission, stating period and recipient. The
          fetch runs only on confirm; the busy guard prevents duplicate posts. */}
      <ConfirmDialog
        open={confirmOpen}
        title="Submit account compile to treasury?"
        description={
          `This will compile and submit the ${selectedMonthName} ${year} (${fyLabel(monthNum, yearNum)}) ` +
          `account statement to "${submittedTo.trim()}".` +
          (alreadyCompiled ? " This period has already been compiled — this is a RE-SUBMISSION." : "")
        }
        confirmLabel="Submit to treasury"
        danger
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

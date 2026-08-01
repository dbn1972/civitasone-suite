"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import type { LibraryBookSummary } from "@civitasone/types";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export function IssueBookForm({
  books,
  defaultBookId,
}: {
  books: LibraryBookSummary[];
  defaultBookId?: string;
}) {
  const router = useRouter();
  const preselect = defaultBookId && books.some((b) => b.id === defaultBookId) ? defaultBookId : "";
  const [bookId, setBookId] = useState(preselect);
  const [employeeRef, setEmployeeRef] = useState("");
  const [dueAt, setDueAt] = useState(defaultDueDate());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ book?: string; employeeRef?: string; dueAt?: string }>({});

  const bookSelectId = useId();
  const employeeId = useId();
  const dueAtId = useId();
  const summaryId = useId();
  const noBooksHelpId = useId();

  const bookErrorId = `${bookSelectId}-error`;
  const employeeErrorId = `${employeeId}-error`;
  const dueAtErrorId = `${dueAtId}-error`;

  const bookRef = useRef<HTMLSelectElement>(null);
  const employeeRefInputRef = useRef<HTMLInputElement>(null);
  const dueAtRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);
  const noBooksAvailable = books.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const errors: { book?: string; employeeRef?: string; dueAt?: string } = {};
    if (!bookId) errors.book = "Select a book to issue.";
    else if (!selected || selected.copiesAvailable <= 0) errors.book = "This book has no copies available.";
    if (!employeeRef.trim()) errors.employeeRef = "Enter the borrowing employee's ID.";
    else if (!UUID_RE.test(employeeRef.trim())) errors.employeeRef = "Enter a valid employee ID (UUID).";
    if (!dueAt) errors.dueAt = "Choose a due date.";
    setFieldErrors(errors);

    if (errors.book) {
      setTone("bad");
      setMessage("Please correct the highlighted field(s).");
      bookRef.current?.focus();
      return;
    }
    if (errors.employeeRef) {
      setTone("bad");
      setMessage("Please correct the highlighted field(s).");
      employeeRefInputRef.current?.focus();
      return;
    }
    if (errors.dueAt) {
      setTone("bad");
      setMessage("Please correct the highlighted field(s).");
      dueAtRef.current?.focus();
      return;
    }

    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function issueBook() {
    if (!selected) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/estab/library/issues", {
        method: "POST",
        body: JSON.stringify({
          bookId: selected.id,
          employeeRef: employeeRef.trim(),
          dueAt: new Date(`${dueAt}T00:00:00.000Z`).toISOString(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Issue submitted (id ${res.id}). It will appear in the loan list shortly.`
          : "Issue submitted.",
      );
      setBookId("");
      setEmployeeRef("");
      setDueAt(defaultDueDate());
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label="Issue a book to a staff member">
      <Card title="Issue a Book" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={bookSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
              Book <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <select
              id={bookSelectId}
              ref={bookRef}
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.book || undefined}
              aria-describedby={fieldErrors.book ? bookErrorId : (noBooksAvailable ? noBooksHelpId : undefined)}
              disabled={noBooksAvailable}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              <option value="">Select a book…</option>
              {books.map((b) => (
                <option key={b.id} value={b.id} disabled={b.copiesAvailable <= 0}>
                  {b.title}{b.author ? ` — ${b.author}` : ""} ({b.copiesAvailable} available)
                </option>
              ))}
            </select>
            {fieldErrors.book && (
              <p id={bookErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.book}
              </p>
            )}
            {noBooksAvailable && (
              <p id={noBooksHelpId} style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
                No copies are currently available to issue.
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={employeeId} style={{ fontSize: 13, fontWeight: 600 }}>
              Employee ID (UUID) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={employeeId}
              ref={employeeRefInputRef}
              value={employeeRef}
              onChange={(e) => setEmployeeRef(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              aria-required="true"
              aria-invalid={!!fieldErrors.employeeRef || undefined}
              aria-describedby={fieldErrors.employeeRef ? employeeErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {fieldErrors.employeeRef && (
              <p id={employeeErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.employeeRef}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={dueAtId} style={{ fontSize: 13, fontWeight: 600 }}>
              Due Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={dueAtId}
              ref={dueAtRef}
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.dueAt || undefined}
              aria-describedby={fieldErrors.dueAt ? dueAtErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {fieldErrors.dueAt && (
              <p id={dueAtErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.dueAt}
              </p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || noBooksAvailable}>
            Issue Book
          </button>
        </div>

        {message && (
          <p
            id={summaryId}
            role={tone === "bad" ? "alert" : "status"}
            className={`pill ${tone}`}
            style={{ width: "fit-content", marginTop: 12 }}
          >
            {message}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Issue this book?"
        confirmLabel="Issue book"
        busy={busy}
        errorMessage={dialogError}
        description={
          selected ? (
            <>
              Issue <strong>{selected.title}</strong> to employee <strong>{employeeRef}</strong>, due back{" "}
              <strong>{dueAt}</strong>.
            </>
          ) : (
            "Issue this book?"
          )
        }
        onConfirm={() => void issueBook()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

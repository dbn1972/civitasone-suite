"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import type { LibraryBookSummary } from "@civitasone/types";

type AcceptedResponse = { id?: string; status?: string };

export function EditBookForm({ book }: { book: LibraryBookSummary }) {
  const router = useRouter();
  const formError = useFormError("book");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [isbn, setIsbn] = useState(book.isbn ?? "");
  const [category, setCategory] = useState(book.category ?? "");
  const [copiesTotal, setCopiesTotal] = useState(book.copiesTotal);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  // Withdraw state
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | undefined>();

  const copiesOut = book.copiesTotal - book.copiesAvailable;
  const isWithdrawn = book.status === "withdrawn";

  async function handleSave() {
    setMessage(null);
    const patch: Record<string, unknown> = {};
    if (title.trim() !== book.title) patch.title = title.trim();
    if (author.trim() !== (book.author ?? "")) patch.author = author.trim() || undefined;
    if (isbn.trim() !== (book.isbn ?? "")) patch.isbn = isbn.trim() || undefined;
    if (category.trim() !== (book.category ?? "")) patch.category = category.trim() || undefined;
    if (copiesTotal !== book.copiesTotal) patch.copiesTotal = copiesTotal;

    if (Object.keys(patch).length === 0) {
      setTone("bad");
      setMessage("No changes to save.");
      return;
    }
    if (!title.trim()) {
      setTone("bad");
      setMessage("Title is required.");
      return;
    }
    if (copiesTotal < copiesOut) {
      setTone("bad");
      setMessage(`Total copies cannot be less than the ${copiesOut} currently on loan.`);
      return;
    }

    setBusy(true);
    try {
      await browserJson<AcceptedResponse>(`v1/estab/library/books/${book.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setTone("good");
      setMessage("Book updated. Changes will appear shortly.");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (withdrawReason.trim().length < 3) {
      setWithdrawError("Please provide a reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setWithdrawError(undefined);
    try {
      await browserJson<AcceptedResponse>(`v1/estab/library/books/${book.id}/withdraw`, {
        method: "PATCH",
        body: JSON.stringify({ reason: withdrawReason.trim() }),
      });
      setWithdrawOpen(false);
      setTone("good");
      setMessage("Book withdrawn from the catalogue.");
      router.refresh();
    } catch (err) {
      setWithdrawError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  if (isWithdrawn) {
    return (
      <Card title="Book management" padding>
        <p className="sub" style={{ margin: 0 }}>This book has been withdrawn from the catalogue.</p>
      </Card>
    );
  }

  if (!editing) {
    return (
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <Button type="button" variant="secondary" onClick={() => setEditing(true)} style={{ minHeight: 44 }}>
          Edit book details
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={copiesOut > 0}
          aria-label={copiesOut > 0 ? `Cannot withdraw: ${copiesOut} copies are on loan` : "Withdraw this book"}
          title={copiesOut > 0 ? `Cannot withdraw: ${copiesOut} copies are on loan` : undefined}
          onClick={() => { setWithdrawReason(""); setWithdrawError(undefined); setWithdrawOpen(true); }}
          style={{ minHeight: 44 }}
        >
          Withdraw book
        </Button>
        <ConfirmDialog
          open={withdrawOpen}
          title="Withdraw this book?"
          confirmLabel="Withdraw"
          busy={busy}
          errorMessage={withdrawError}
          description={
            <>
              <p>This will permanently remove <strong>{book.title}</strong> from the active catalogue. Provide a reason:</p>
              <textarea
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                placeholder="Reason for withdrawal…"
                rows={2}
                aria-label="Reason for withdrawal"
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--line)", marginTop: 8 }}
              />
            </>
          }
          onConfirm={() => void handleWithdraw()}
          onCancel={() => !busy && setWithdrawOpen(false)}
        />
      </div>
    );
  }

  return (
    <Card title="Edit book details" padding>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
          Title *
          <input value={title} onChange={(e) => setTitle(e.target.value)} required
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
          Author
          <input value={author} onChange={(e) => setAuthor(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
          ISBN
          <input value={isbn} onChange={(e) => setIsbn(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
          Category
          <input value={category} onChange={(e) => setCategory(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
          Total Copies
          <input type="number" min={copiesOut} step={1} value={copiesTotal}
            onChange={(e) => setCopiesTotal(Math.max(copiesOut, Number(e.target.value) || 0))}
            aria-describedby="copies-help"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          {copiesOut > 0 && (
            <span id="copies-help" style={{ fontSize: 12, color: "var(--ink2)" }}>
              Minimum {copiesOut} (copies currently on loan).
            </span>
          )}
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Button type="button" onClick={() => void handleSave()} disabled={busy} style={{ minHeight: 44 }}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={busy} style={{ minHeight: 44 }}>
          Cancel
        </Button>
      </div>
      {message && (
        <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content", marginTop: 12 }}>
          {message}
        </p>
      )}
    </Card>
  );
}

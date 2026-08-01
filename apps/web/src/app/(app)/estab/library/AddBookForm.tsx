"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

type FieldKey = "accessionNo" | "title" | "copiesTotal";

export function AddBookForm() {
  const router = useRouter();
  const [accessionNo, setAccessionNo] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [category, setCategory] = useState("");
  const [copiesTotal, setCopiesTotal] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const accessionId = useId();
  const titleId = useId();
  const authorId = useId();
  const isbnId = useId();
  const categoryId = useId();
  const copiesId = useId();
  const summaryId = useId();

  const accessionErrorId = `${accessionId}-error`;
  const titleErrorId = `${titleId}-error`;
  const copiesErrorId = `${copiesId}-error`;

  const accessionRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const copiesRef = useRef<HTMLInputElement>(null);

  const fieldRefs: Record<FieldKey, React.RefObject<HTMLInputElement>> = {
    accessionNo: accessionRef,
    title: titleRef,
    copiesTotal: copiesRef,
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const errors: Partial<Record<FieldKey, string>> = {};
    if (!accessionNo.trim()) errors.accessionNo = "Enter an accession number.";
    if (!title.trim()) errors.title = "Enter the book title.";
    const copiesNum = Number(copiesTotal);
    if (!copiesTotal.trim() || !Number.isInteger(copiesNum) || copiesNum <= 0) {
      errors.copiesTotal = "Enter a whole number of copies greater than zero.";
    }
    setFieldErrors(errors);

    const firstInvalid = (Object.keys(errors) as FieldKey[])[0];
    if (firstInvalid) {
      setTone("bad");
      setMessage("Please correct the highlighted field(s).");
      fieldRefs[firstInvalid].current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await browserJson<AcceptedResponse>("v1/estab/library/books", {
        method: "POST",
        body: JSON.stringify({
          accessionNo: accessionNo.trim(),
          title: title.trim(),
          author: author.trim() || undefined,
          isbn: isbn.trim() || undefined,
          category: category.trim() || undefined,
          copiesTotal: copiesNum,
        }),
      });
      setTone("good");
      setMessage(
        res.id
          ? `Book submitted (id ${res.id}). It will appear in the catalogue shortly.`
          : "Book submitted.",
      );
      setAccessionNo("");
      setTitle("");
      setAuthor("");
      setIsbn("");
      setCategory("");
      setCopiesTotal("1");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginBottom: 16 }} aria-label="Add a book to the library catalogue">
      <Card title="Add a Book" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={accessionId} style={{ fontSize: 13, fontWeight: 600 }}>
              Accession No. <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={accessionId}
              ref={accessionRef}
              value={accessionNo}
              onChange={(e) => setAccessionNo(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.accessionNo || undefined}
              aria-describedby={fieldErrors.accessionNo ? accessionErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {fieldErrors.accessionNo && (
              <p id={accessionErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.accessionNo}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={titleId} style={{ fontSize: 13, fontWeight: 600 }}>
              Title <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={titleId}
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.title || undefined}
              aria-describedby={fieldErrors.title ? titleErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {fieldErrors.title && (
              <p id={titleErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={authorId} style={{ fontSize: 13, fontWeight: 600 }}>Author</label>
            <input
              id={authorId}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={isbnId} style={{ fontSize: 13, fontWeight: 600 }}>ISBN</label>
            <input
              id={isbnId}
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={categoryId} style={{ fontSize: 13, fontWeight: 600 }}>Category</label>
            <input
              id={categoryId}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={copiesId} style={{ fontSize: 13, fontWeight: 600 }}>
              Copies <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={copiesId}
              ref={copiesRef}
              type="number"
              min={1}
              step={1}
              value={copiesTotal}
              onChange={(e) => setCopiesTotal(e.target.value)}
              aria-required="true"
              aria-invalid={!!fieldErrors.copiesTotal || undefined}
              aria-describedby={fieldErrors.copiesTotal ? copiesErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {fieldErrors.copiesTotal && (
              <p id={copiesErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.copiesTotal}
              </p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? "Adding…" : "Add Book"}
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
    </form>
  );
}

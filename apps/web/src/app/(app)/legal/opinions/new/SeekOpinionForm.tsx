"use client";

import { UserFacingError } from "@/lib/userFacingError";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * "Seek Opinion" form.
 *
 * GAP-LEGAL-OPINIONS-NEW-01: posts to the real opinions create command
 * (POST /api/v1/legal/opinions), so the request lands in the Legal Opinions
 * repository the user is redirected to — not the notices register. The server
 * returns the new opinion id; we redirect to its detail page.
 *
 * GAP-LEGAL-OPINIONS-NEW-02: the reference number is allocated server-side in
 * the OPN/<year>/NNNN series. The form no longer generates one with
 * Math.random(); an optional reference is only sent if the user explicitly
 * typed one.
 *
 * Recording the request is irreversible, so submission is gated behind an
 * accessible ConfirmDialog.
 */
export function SeekOpinionForm() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState("");
  const createdIdRef = useRef<string | null>(null);
  const formError = useFormError("opinion request");

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const body = {
        // GAP-LEGAL-OPINIONS-NEW-02: send a reference ONLY if the user typed
        // one; otherwise the server allocates the next in the series.
        ...(reference.trim() ? { opinionNo: reference.trim() } : {}),
        subject: subject.trim(),
        question: question.trim(),
      };
      const res = await fetch("/api/proxy/v1/legal/opinions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      createdIdRef.current = typeof data.id === "string" ? data.id : null;
    },
    onSuccess: () => {
      // GAP-LEGAL-OPINIONS-NEW-01: redirect to the created opinion's detail
      // page so the requester sees exactly what was recorded.
      const id = createdIdRef.current;
      router.push(id ? `/legal/opinions/${id}` : "/legal/opinions");
      router.refresh();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 3 || question.trim().length < 3) {
      setMessage("Opinion subject and the question (each min 3 chars) are required.");
      return;
    }
    setMessage("");
    trigger();
  }

  return (
    <form onSubmit={handleSubmit} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="reference">Reference no</label>
          <input id="reference" className="inp" value={reference} onChange={(e) => setReference(e.target.value)} style={{ minHeight: 44 }} placeholder="Assigned on submit" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="subject">Subject *</label>
          <input id="subject" className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={256} style={{ minHeight: 44 }} placeholder="Short subject of the opinion sought" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="question">Question *</label>
          <textarea id="question" className="inp" rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} required maxLength={4000} placeholder="Describe the question on which an opinion is sought" />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </Button>
        <Link href="/legal/opinions" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>

      <ConfirmDialog
        open={open}
        title="Submit this opinion request?"
        description="This records a request in the Legal Opinions repository with status pending. Confirm the subject and question are correct before submitting."
        confirmLabel="Submit request"
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </form>
  );
}

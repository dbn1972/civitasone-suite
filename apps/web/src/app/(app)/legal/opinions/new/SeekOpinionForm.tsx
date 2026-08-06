"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, useConfirmAction } from "../../../../_components/ds";

/**
 * "Seek Opinion" form — posts POST /v1/legal/opinions (seekOpinionBody:
 * opinionNo, subject, question, soughtBy). It previously posted into the
 * write-only notices module, so requests vanished and never appeared on the
 * opinions register.
 *
 * Recording the request is irreversible, so submission is gated behind an
 * accessible ConfirmDialog (maker-checker).
 */
export function SeekOpinionForm() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [subject, setSubject] = useState("");
  const [addressedTo, setAddressedTo] = useState("");
  const [message, setMessage] = useState("");

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const ref = reference.trim() || `OPN/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
      const body = {
        opinionNo: ref,
        subject: subject.trim().slice(0, 256),
        question: subject.trim(),
        soughtBy: addressedTo.trim(),
      };
      const res = await fetch("/api/proxy/v1/legal/opinions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
    },
    onSuccess: () => {
      router.push("/legal/opinions");
      router.refresh();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 3 || !addressedTo.trim()) {
      setMessage("Opinion subject (min 3 chars) and addressee are required.");
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
          <input id="reference" className="inp" value={reference} onChange={(e) => setReference(e.target.value)} style={{ minHeight: 44 }} placeholder="Auto-generated if blank" />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="addressedTo">Addressed to *</label>
          <input id="addressedTo" className="inp" value={addressedTo} onChange={(e) => setAddressedTo(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Law Department / Sr. Counsel" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="subject">Opinion sought on *</label>
          <textarea id="subject" className="inp" rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={256} placeholder="Describe the question on which an opinion is sought" />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role="alert" style={{ marginTop: 12, color: "#b91c1c", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </button>
        <Link href="/legal/opinions" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>

      <ConfirmDialog
        open={open}
        title="Submit this opinion request?"
        description="This records an outbound request to the addressee and cannot be withdrawn. Confirm the subject and addressee are correct."
        confirmLabel="Submit request"
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </form>
  );
}

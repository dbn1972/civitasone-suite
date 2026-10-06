"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

export function CreateCaseForm() {
  const router = useRouter();
  const [caseNo, setCaseNo] = useState("");
  const [title, setTitle] = useState("");
  const [court, setCourt] = useState("");
  const [petitioner, setPetitioner] = useState("");
  const [respondent, setRespondent] = useState("");
  const [subject, setSubject] = useState("");
  const [counselRef, setCounselRef] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("case");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseNo.trim() || !title.trim() || !court.trim()) {
      setStatus("error");
      setMessage("Case number, title and court are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      caseNo: caseNo.trim(),
      title: title.trim(),
      court: court.trim(),
      subject: subject.trim() || undefined,
      petitioner: petitioner.trim() || undefined,
      counselRef: counselRef.trim() || undefined,
      // GAP-LEGAL-CASES-NEW-02: respondent is captured via the backend's
      // `parties` array (createCaseBody.parties), the only place the create
      // schema accepts a respondent name.
      parties: respondent.trim()
        ? [{ name: respondent.trim(), role: "respondent" as const }]
        : undefined,
    };
    try {
      const res = await fetch("/api/proxy/v1/legal/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-LEGAL-CASES-NEW-03: the create endpoint is accepted-async and
      // returns { id, status:"accepted" } without a readable case row yet, so
      // we return to the list (where the new case appears) rather than a
      // detail route that would 404 until the consumer has written the row.
      router.push("/legal/list");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field">
          <label className="label" htmlFor="caseNo">Case number *</label>
          <input id="caseNo" className="inp" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. WP/1234/2024" />
        </div>
        <div className="field">
          <label className="label" htmlFor="court">Court / Forum *</label>
          <input id="court" className="inp" value={court} onChange={(e) => setCourt(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. High Court" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="title">Case title *</label>
          <input id="title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. State vs. ABC Pvt Ltd" />
        </div>
        <div className="field">
          <label className="label" htmlFor="petitioner">Petitioner</label>
          <input id="petitioner" className="inp" value={petitioner} onChange={(e) => setPetitioner(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="respondent">Respondent</label>
          <input id="respondent" className="inp" value={respondent} onChange={(e) => setRespondent(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="counselRef">Counsel reference</label>
          <input id="counselRef" className="inp" value={counselRef} onChange={(e) => setCounselRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="subject">Subject</label>
          <textarea id="subject" className="inp" rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Register case"}
        </Button>
        <Link href="/legal/list" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}

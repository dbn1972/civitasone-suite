"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

interface CaseTypeOption {
  id: string;
  code: string;
  name: string;
}

export function CreateCaseForm() {
  const router = useRouter();
  const [caseNo, setCaseNo] = useState("");
  const [title, setTitle] = useState("");
  const [court, setCourt] = useState("");
  const [petitioner, setPetitioner] = useState("");
  const [respondent, setRespondent] = useState("");
  const [subject, setSubject] = useState("");
  const [counselRef, setCounselRef] = useState("");
  const [caseTypeId, setCaseTypeId] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("case");

  // GAP-LEGAL-CASES-NEW-01: load the case-type master so the registrar can pick
  // an explicit type (writ/civil/criminal/…) that the backend stores as
  // caseTypeId. Client-side fetch (this is a "use client" form); an empty master
  // shows an honest hint rather than an empty mandatory select.
  const [caseTypes, setCaseTypes] = useState<CaseTypeOption[]>([]);
  const [caseTypesLoaded, setCaseTypesLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/legal/case-types");
        if (!res.ok) {
          if (active) setCaseTypesLoaded(true);
          return;
        }
        const data = (await res.json()) as { items?: CaseTypeOption[] };
        if (active) {
          setCaseTypes(data.items ?? []);
          setCaseTypesLoaded(true);
        }
      } catch {
        if (active) setCaseTypesLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
      // GAP-LEGAL-CASES-NEW-01: send the explicit case type (caseTypeId) when the
      // registrar picked one from the master. Optional — omitted falls back to
      // the caseNo-prefix heuristic in the list classifier.
      caseTypeId: caseTypeId || undefined,
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
        <div className="field">
          <label className="label" htmlFor="caseType">Case type</label>
          <select
            id="caseType"
            className="inp"
            value={caseTypeId}
            onChange={(e) => setCaseTypeId(e.target.value)}
            style={{ minHeight: 44 }}
            disabled={caseTypes.length === 0}
          >
            <option value="">{caseTypes.length === 0 ? "No case types configured" : "Select a case type…"}</option>
            {caseTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {caseTypesLoaded && caseTypes.length === 0 && (
            <p style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--ink2)" }}>
              No case types are configured yet. An administrator can seed the defaults in Legal settings; cases
              will meanwhile be classified from the case-number prefix.
            </p>
          )}
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

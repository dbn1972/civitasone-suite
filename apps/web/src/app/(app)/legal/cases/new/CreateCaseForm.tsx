"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

interface CaseTypeOption {
  id: string;
  code: string;
  name: string;
}

interface CourtOption { code: string; name: string; kind: "supreme" | "high_court" | "district" | "tribunal" }
interface DepartmentOption { id: string; name: string }

const OTHER = "other";
const COURT_GROUPS: ReadonlyArray<CourtOption["kind"]> = ["supreme", "high_court", "district", "tribunal"];

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Poll the new case detail until the async create consumer has written it. */
async function waitForCase(id: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(`/api/proxy/v1/legal/cases/${encodeURIComponent(id)}`);
      if (res.ok) return true;
      if (res.status !== 404) return false;
    } catch {
      return false;
    }
  }
  return false;
}

export function CreateCaseForm() {
  const t = useTranslations("legalCaseNew");
  const router = useRouter();
  const [caseNo, setCaseNo] = useState("");
  const [title, setTitle] = useState("");
  // GAP-LEGAL-CASES-NEW-02 (owner decision #10): court from the master, or "Other" free text (unverified).
  const [courtCode, setCourtCode] = useState("");
  const [courtOther, setCourtOther] = useState("");
  const [filingDate, setFilingDate] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState("");
  // GAP-LEGAL-CASES-DETAIL-06 (owner decision #12): privileged / confidential case.
  const [privileged, setPrivileged] = useState(false);
  const [courts, setCourts] = useState<CourtOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [refData, setRefData] = useState<"loading" | "ready" | "error">("loading");
  const [petitioner, setPetitioner] = useState("");
  const [respondent, setRespondent] = useState("");
  const [subject, setSubject] = useState("");
  const [counselRef, setCounselRef] = useState("");
  // GAP-LEGAL-LIST-04 (owner decision #14): link the case to an empanelled advocate (counselRef stays as a free-text fallback).
  const [advocateId, setAdvocateId] = useState("");
  const [advocates, setAdvocates] = useState<Array<{ id: string; name: string; barEnrolmentNo: string }>>([]);
  const [advocatesFailed, setAdvocatesFailed] = useState(false);
  const [caseTypeId, setCaseTypeId] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [caseNoError, setCaseNoError] = useState("");
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
        const [c, d] = await Promise.all([
          fetch("/api/proxy/v1/legal/courts"),
          fetch("/api/proxy/v1/legal/departments"),
        ]);
        if (!c.ok || !d.ok) throw new Error("reference data unavailable");
        const cj = (await c.json()) as { items?: CourtOption[] };
        const dj = (await d.json()) as { items?: DepartmentOption[] };
        if (active) { setCourts(cj.items ?? []); setDepartments(dj.items ?? []); setRefData("ready"); }
      } catch {
        if (active) setRefData("error");
      }
      try {
        const a = await fetch("/api/proxy/v1/legal/advocates");
        if (!a.ok) throw new Error("advocates unavailable");
        const aj = (await a.json()) as { items?: Array<{ id: string; name: string; barEnrolmentNo: string }> };
        if (active) setAdvocates(aj.items ?? []);
      } catch {
        if (active) setAdvocatesFailed(true);
      }
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
    const courtMissing = courtCode === "" || (courtCode === OTHER && !courtOther.trim());
    if (!caseNo.trim() || !title.trim() || courtMissing) {
      setStatus("error");
      setMessage("Case number, title and court are required.");
      return;
    }
    if (!filingDate || filingDate > todayIso()) {
      setStatus("error");
      setMessage(t("filingDateInvalid"));
      return;
    }
    if (!departmentId) {
      setStatus("error");
      setMessage(t("departmentRequired"));
      return;
    }
    setStatus("submitting");
    setMessage("");
    setCaseNoError("");
    const body = {
      caseNo: caseNo.trim(),
      title: title.trim(),
      courtCode,
      // Only "Other" carries free text; a master court is named by the server.
      ...(courtCode === OTHER ? { court: courtOther.trim() } : {}),
      filingDate,
      departmentId,
      ...(privileged ? { privileged: true } : {}),
      subject: subject.trim() || undefined,
      petitioner: petitioner.trim() || undefined,
      counselRef: counselRef.trim() || undefined,
      advocateId: advocateId || undefined,
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
        // GAP-LEGAL-CASES-NEW-03: a duplicate case number is a field-level
        // problem (409 DUPLICATE_CASE_NO), shown against the Case number input.
        const code = await res.clone().json().then((b: { code?: string }) => b?.code, () => undefined);
        if (res.status === 409 && code === "DUPLICATE_CASE_NO") {
          setCaseNoError("A case with this case number already exists. Check the number or open the existing case.");
          setMessage("Case number is already registered.");
          return;
        }
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-LEGAL-CASES-NEW-03: the create endpoint is accepted-async and
      // returns { id, status:"accepted" }; the case row is written by the
      // consumer a moment later. Wait (briefly) until the detail is readable
      // and open the new case; fall back to the list if it is not there yet.
      const accepted = (await res.json().catch(() => ({}))) as { id?: string };
      const newId = typeof accepted.id === "string" ? accepted.id : null;
      if (newId && (await waitForCase(newId))) {
        router.push(`/legal/cases/${newId}`);
        router.refresh();
        return;
      }
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
          <input id="caseNo" className="inp" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. WP/1234/2024" aria-invalid={caseNoError ? true : undefined} aria-describedby={caseNoError ? "caseNo-error" : undefined} />
          {caseNoError ? (
            <p id="caseNo-error" role="alert" style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--bad)" }}>{caseNoError}</p>
          ) : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="court">Court / Forum *</label>
          <select id="court" className="inp" value={courtCode} onChange={(e) => setCourtCode(e.target.value)} required style={{ minHeight: 44 }} disabled={refData !== "ready"}>
            <option value="">{refData === "loading" ? t("loading") : t("selectCourt")}</option>
            {COURT_GROUPS.map((kind) => {
              const group = courts.filter((c) => c.kind === kind);
              return group.length === 0 ? null : (
                <optgroup key={kind} label={t(`group.${kind}`)}>
                  {group.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </optgroup>
              );
            })}
            <option value={OTHER}>{t("courtOtherOption")}</option>
          </select>
          {courtCode === OTHER ? (
            <div style={{ marginTop: 8 }}>
              <label className="label" htmlFor="courtOther">{t("courtOtherLabel")}</label>
              <input id="courtOther" className="inp" value={courtOther} onChange={(e) => setCourtOther(e.target.value)} required maxLength={128} style={{ minHeight: 44 }} />
              <p style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--ink2)" }}>{t("courtUnverifiedNote")}</p>
            </div>
          ) : null}
          {refData === "error" ? (
            <p role="alert" style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--bad)" }}>{t("refDataError")}</p>
          ) : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="filingDate">{t("filingDateLabel")}</label>
          <input id="filingDate" type="date" className="inp" value={filingDate} max={todayIso()} onChange={(e) => setFilingDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="department">{t("departmentLabel")}</label>
          <select id="department" className="inp" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required style={{ minHeight: 44 }} disabled={refData !== "ready"}>
            <option value="">{refData === "loading" ? t("loading") : t("selectDepartment")}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {refData === "ready" && departments.length === 0 ? (
            <p style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--ink2)" }}>{t("departmentsEmpty")}</p>
          ) : null}
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
          <label className="label" htmlFor="advocateId">{t("advocateLabel")}</label>
          <select id="advocateId" className="inp" value={advocateId} onChange={(e) => setAdvocateId(e.target.value)} style={{ minHeight: 44 }}>
            <option value="">{t("advocateNone")}</option>
            {advocates.map((a) => <option key={a.id} value={a.id}>{`${a.name} (${a.barEnrolmentNo})`}</option>)}
          </select>
          {advocatesFailed ? <p role="alert" style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--bad)" }}>{t("advocatesError")}</p> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="counselRef">Counsel reference</label>
          <input id="counselRef" className="inp" value={counselRef} onChange={(e) => setCounselRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="privileged" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <input id="privileged" type="checkbox" checked={privileged} onChange={(e) => setPrivileged(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              {t("privilegedLabel")}
              <span style={{ display: "block", fontSize: "0.75rem", color: "var(--ink2)", fontWeight: 400 }}>{t("privilegedHelp")}</span>
            </span>
          </label>
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

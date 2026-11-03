"use client";

/**
 * UAT J11 / D7: open a disciplinary case on screen. The register and the case
 * page could issue a charge memo, impose a penalty and close a case, but no
 * screen called POST /v1/hrms/employees/:id/disciplinary-cases, so a case
 * could only be opened through the API. This dialog collects exactly what that
 * route validates (employee, case number, proceeding type, allegation) and
 * links to the new case. The backend stays the authority on role and employee
 * checks; the case is written by a queue consumer, so the copy says "opened"
 * and the link may need a moment before the case page shows it.
 */
import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input, Select, Textarea } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

/** Limits of the backend route's zod body (disciplinary/routes.ts). */
export const CASE_NO_MAX = 48;
export const ALLEGATION_MAX = 8000;

export type OpenCaseInput = { employeeId: string | null; caseNo: string; proceedingType: string; allegation: string };

/** The request body, or null while a required field is missing or out of range. */
export function buildOpenCaseBody(v: OpenCaseInput): { caseNo: string; proceedingType: "minor" | "major"; allegation: string } | null {
  const caseNo = v.caseNo.trim();
  const allegation = v.allegation.trim();
  if (!v.employeeId) return null;
  if (caseNo === "" || caseNo.length > CASE_NO_MAX) return null;
  if (allegation === "" || allegation.length > ALLEGATION_MAX) return null;
  if (v.proceedingType !== "minor" && v.proceedingType !== "major") return null;
  return { caseNo, proceedingType: v.proceedingType, allegation };
}

export function OpenCaseAction() {
  const t = useTranslations("disciplinaryOpenCase");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [caseNo, setCaseNo] = useState("");
  const [proceedingType, setProceedingType] = useState("major");
  const [allegation, setAllegation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<{ id: string; caseNo: string } | null>(null);
  const empId = useId();
  const caseNoId = useId();
  const typeId = useId();
  const allegationId = useId();

  const body = buildOpenCaseBody({ employeeId, caseNo, proceedingType, allegation });

  function start() {
    setEmployeeId(null);
    setCaseNo("");
    setProceedingType("major");
    setAllegation("");
    setError("");
    setOpen(true);
  }

  async function submit() {
    if (!body || !employeeId) return;
    setBusy(true);
    setError("");
    try {
      const res = await browserFetch(`v1/hrms/employees/${employeeId}/disciplinary-cases`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 404) setError(t("errEmployeeNotFound"));
        else if (res.status === 403) setError(t("errForbidden"));
        else setError(await errorMessageFromResponse(res));
        return;
      }
      const out = (await res.json().catch(() => ({}))) as { id?: string; caseNo?: string };
      setOpen(false);
      if (out.id) setOpened({ id: out.id, caseNo: out.caseNo ?? body.caseNo });
      router.refresh();
    } catch {
      setError(t("errNetwork"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={start}>{t("button")}</Button>
      {opened && (
        <p role="status" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--good)" }}>
          {t("opened", { caseNo: opened.caseNo })}{" "}
          <Link href={`/hr/disciplinary/${opened.id}`} className="lnk">{t("viewCase")}</Link>
        </p>
      )}
      {open && (
        <ConfirmDialog
          open
          title={t("title")}
          description={t("description")}
          confirmLabel={t("confirm")}
          busy={busy}
          confirmDisabled={!body}
          errorMessage={error}
          onConfirm={() => { void submit(); }}
          onCancel={() => { if (!busy) setOpen(false); }}
        >
          <div style={{ display: "grid", gap: 10, margin: "8px 0" }}>
            <Field id={empId} label={t("employee")} required>
              <EmployeePicker id={empId} value={employeeId} onChange={(id) => setEmployeeId(id)} clearable />
            </Field>
            <Field id={caseNoId} label={t("caseNo")} required>
              <Input id={caseNoId} value={caseNo} maxLength={CASE_NO_MAX} onChange={(e) => setCaseNo(e.target.value)} />
            </Field>
            <Field id={typeId} label={t("proceedingType")} required>
              <Select id={typeId} value={proceedingType} onChange={(e) => setProceedingType(e.target.value)}>
                <option value="major">{t("major")}</option>
                <option value="minor">{t("minor")}</option>
              </Select>
            </Field>
            <Field id={allegationId} label={t("allegation")} required>
              <Textarea id={allegationId} value={allegation} maxLength={ALLEGATION_MAX} rows={4} onChange={(e) => setAllegation(e.target.value)} />
            </Field>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

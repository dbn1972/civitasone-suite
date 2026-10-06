"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

// GAP-PROJECTS-NEW-01: the form captured no scheme or implementing agency, so
// every project created here showed "—" in the list's Scheme and Agency/Dept
// columns and could not be linked to a scheme. POST /v1/projects accepts
// `schemeId` (uuid, optional) and `agencyRef` (string, optional) — verified
// against services/project-service/src/modules/project/validators.ts
// (createProjectBody). There is NO `department` field on the backend contract,
// so this wires the real `agencyRef` (the list's "Agency / Dept" column)
// rather than an invented key the API would silently drop.
export type SchemeOption = { id: string; schemeCode: string; name: string };

type FieldErrors = Partial<Record<"code" | "projectName" | "endDate" | "sanctionedRupees" | "dprCostRupees", string>>;

export function CreateProjectForm({ schemes = [] }: { schemes?: SchemeOption[] }) {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [agencyRef, setAgencyRef] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sanctionedRupees, setSanctionedRupees] = useState("");
  const [dprCostRupees, setDprCostRupees] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formError = useFormError("project");

  const refs = {
    code: useRef<HTMLInputElement>(null),
    projectName: useRef<HTMLInputElement>(null),
    endDate: useRef<HTMLInputElement>(null),
    sanctionedRupees: useRef<HTMLInputElement>(null),
    dprCostRupees: useRef<HTMLInputElement>(null),
  };

  // GAP-PROJECTS-NEW-02: collect ALL field errors (not just the first), so each
  // field can render its own message with aria-describedby and focus can move
  // to the first invalid field. GAP-PROJECTS-NEW-04: money is validated with
  // rupeesToMinorString (float-free; rejects >2 decimals like "1.005").
  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!code.trim()) errs.code = "Project code is required.";
    else if (code.trim().length > 64) errs.code = "Project code must be 64 characters or fewer.";
    if (!projectName.trim()) errs.projectName = "Project name is required.";
    if (startDate && endDate && endDate < startDate) errs.endDate = "End date must be on or after start date.";
    if (sanctionedRupees.trim() && rupeesToMinorString(sanctionedRupees, { allowZero: true }) === null) {
      errs.sanctionedRupees = "Enter a valid amount in rupees (up to 2 decimal places).";
    }
    if (dprCostRupees.trim() && rupeesToMinorString(dprCostRupees, { allowZero: true }) === null) {
      errs.dprCostRupees = "Enter a valid amount in rupees (up to 2 decimal places).";
    }
    return errs;
  }

  const sanctionedMinor =
    sanctionedRupees.trim() ? rupeesToMinorString(sanctionedRupees, { allowZero: true }) : null;
  const dprCostMinor = dprCostRupees.trim() ? rupeesToMinorString(dprCostRupees, { allowZero: true }) : null;

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    const order: (keyof typeof refs)[] = ["code", "projectName", "endDate", "sanctionedRupees", "dprCostRupees"];
    const firstInvalid = order.find((f) => errs[f]);
    if (firstInvalid) {
      setStatus("error");
      setMessage("Please fix the highlighted fields.");
      refs[firstInvalid].current?.focus();
      return;
    }
    setStatus("idle");
    setMessage("");
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    setStatus("submitting");
    setMessage("");

    const body: Record<string, unknown> = {
      code: code.trim(),
      name: projectName.trim(),
    };
    if (schemeId) body.schemeId = schemeId;
    if (agencyRef.trim()) body.agencyRef = agencyRef.trim();
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    // The API expects integer paise (createProjectBody: z.number().int()).
    // rupeesToMinorString did the float-free rupee->paise conversion; paise for
    // any realistic sanction is well within Number.MAX_SAFE_INTEGER.
    if (sanctionedMinor !== null) body.sanctionedMinor = Number(sanctionedMinor);
    if (dprCostMinor !== null) body.dprCostMinor = Number(dprCostMinor);

    try {
      const res = await fetch("/api/proxy/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      router.push("/projects/list");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  const sanctionedEcho = sanctionedMinor !== null ? formatMoney(sanctionedMinor) : null;
  const dprEcho = dprCostMinor !== null ? formatMoney(dprCostMinor) : null;

  return (
    <>
      <form
        onSubmit={(e) => void handleFormSubmit(e)}
        className="card pad"
        style={{ maxWidth: 820 }}
        noValidate
        aria-busy={status === "submitting"}
      >
        <div className="fields">
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="code">Project code *</label>
            <input
              id="code"
              ref={refs.code}
              className="inp"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              aria-required="true"
              aria-invalid={fieldErrors.code ? true : undefined}
              aria-describedby={fieldErrors.code ? "code-err" : undefined}
              maxLength={64}
              style={{ minHeight: 44 }}
              placeholder="e.g. PRJ-2024-001"
            />
            {fieldErrors.code && <p id="code-err" style={{ color: "#b91c1c", fontSize: "0.8rem", marginTop: 4 }}>{fieldErrors.code}</p>}
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="projectName">Project name *</label>
            <input
              id="projectName"
              ref={refs.projectName}
              className="inp"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              aria-required="true"
              aria-invalid={fieldErrors.projectName ? true : undefined}
              aria-describedby={fieldErrors.projectName ? "projectName-err" : undefined}
              style={{ minHeight: 44 }}
              placeholder="e.g. NH-48 Widening Phase II"
            />
            {fieldErrors.projectName && <p id="projectName-err" style={{ color: "#b91c1c", fontSize: "0.8rem", marginTop: 4 }}>{fieldErrors.projectName}</p>}
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="schemeId">Scheme</label>
            <select
              id="schemeId"
              className="inp"
              value={schemeId}
              onChange={(e) => setSchemeId(e.target.value)}
              style={{ minHeight: 44 }}
            >
              <option value="">— No scheme —</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.schemeCode})
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="agencyRef">Implementing agency / department</label>
            <input
              id="agencyRef"
              className="inp"
              value={agencyRef}
              onChange={(e) => setAgencyRef(e.target.value)}
              style={{ minHeight: 44 }}
              placeholder="e.g. PWD, Rural Development Dept."
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="startDate">Start date</label>
            <input
              id="startDate"
              type="date"
              className="inp"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ minHeight: 44 }}
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="endDate">End date</label>
            <input
              id="endDate"
              ref={refs.endDate}
              type="date"
              className="inp"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={fieldErrors.endDate ? true : undefined}
              aria-describedby={fieldErrors.endDate ? "endDate-err" : undefined}
              style={{ minHeight: 44 }}
            />
            {fieldErrors.endDate && <p id="endDate-err" style={{ color: "#b91c1c", fontSize: "0.8rem", marginTop: 4 }}>{fieldErrors.endDate}</p>}
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="sanctionedRupees">Sanctioned amount (₹)</label>
            <input
              id="sanctionedRupees"
              ref={refs.sanctionedRupees}
              type="text"
              inputMode="decimal"
              className="inp"
              value={sanctionedRupees}
              onChange={(e) => setSanctionedRupees(e.target.value)}
              aria-invalid={fieldErrors.sanctionedRupees ? true : undefined}
              aria-describedby={fieldErrors.sanctionedRupees ? "sanctionedRupees-err" : "sanctionedRupees-echo"}
              style={{ minHeight: 44 }}
              placeholder="e.g. 5000000"
            />
            {fieldErrors.sanctionedRupees
              ? <p id="sanctionedRupees-err" style={{ color: "#b91c1c", fontSize: "0.8rem", marginTop: 4 }}>{fieldErrors.sanctionedRupees}</p>
              : sanctionedEcho && <p id="sanctionedRupees-echo" style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 4 }}>{sanctionedEcho}</p>}
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="dprCostRupees">DPR cost (₹)</label>
            <input
              id="dprCostRupees"
              ref={refs.dprCostRupees}
              type="text"
              inputMode="decimal"
              className="inp"
              value={dprCostRupees}
              onChange={(e) => setDprCostRupees(e.target.value)}
              aria-invalid={fieldErrors.dprCostRupees ? true : undefined}
              aria-describedby={fieldErrors.dprCostRupees ? "dprCostRupees-err" : "dprCostRupees-echo"}
              style={{ minHeight: 44 }}
              placeholder="e.g. 250000"
            />
            {fieldErrors.dprCostRupees
              ? <p id="dprCostRupees-err" style={{ color: "#b91c1c", fontSize: "0.8rem", marginTop: 4 }}>{fieldErrors.dprCostRupees}</p>
              : dprEcho && <p id="dprCostRupees-echo" style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 4 }}>{dprEcho}</p>}
          </div>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p
              role={status === "error" ? "alert" : undefined}
              style={{
                marginTop: 12,
                color: status === "error" ? "#b91c1c" : "#047857",
                fontSize: "0.875rem",
              }}
            >
              {message}
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button
            type="submit"
            variant="primary"
            style={{ minHeight: 44 }}
            disabled={status === "submitting"}
          >
            {status === "submitting" ? "Saving…" : "Create project"}
          </Button>
          {/* GAP-PROJECTS-NEW-05 (decision): Cancel returns to /projects/list,
              the natural parent and the hub's first projects link. Kept as a
              fixed, predictable target rather than history-dependent
              router.back() — low impact, recorded in the batch report. */}
          <Link href="/projects/list" className="btn ghost" style={{ minHeight: 44 }}>
            Cancel
          </Link>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Create project"
        description={
          `This will register the project in the system.` +
          (sanctionedEcho ? ` Sanctioned amount: ${sanctionedEcho}.` : "") +
          ` Are you sure?`
        }
        confirmLabel="Create project"
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

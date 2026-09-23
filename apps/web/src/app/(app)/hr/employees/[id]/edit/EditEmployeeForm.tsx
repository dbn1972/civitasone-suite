"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeDetail } from "@civitasone/types";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";
import { useTranslations } from "next-intl";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

interface Props {
  employee: EmployeeDetail;
}

type EmployeeOption = { id: string; name?: string; employeeNo?: string };
type PayStructureOption = { id: string; name?: string; code?: string };

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "var(--panel, #fff)",
  color: "var(--ink, #0f172a)",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink, #0f172a)",
};

export function EditEmployeeForm({ employee }: Props) {
  const t = useTranslations("employeeEdit");
  const formId = useId();
  const router = useRouter();

  const [mobile, setMobile] = useState(employee.phone ?? "");
  const [email, setEmail] = useState(employee.email ?? "");
  const [managerId, setManagerId] = useState(employee.reportingTo ?? "");
  const [payStructureId, setPayStructureId] = useState("");

  // Statutory & financial fields
  const [bankAccountNo, setBankAccountNo] = useState((employee as Record<string,unknown>).bankAccountNo as string ?? "");
  const [bankIfsc, setBankIfsc] = useState((employee as Record<string,unknown>).bankIfsc as string ?? "");
  const [uanNumber, setUanNumber] = useState((employee as Record<string,unknown>).uanNumber as string ?? "");
  const [esicIpNumber, setEsicIpNumber] = useState((employee as Record<string,unknown>).esicIpNumber as string ?? "");
  const [pran, setPran] = useState((employee as Record<string,unknown>).pran as string ?? "");

  // Dropdown options for manager and pay structure (follows WFHRequestForm pattern)
  const [managerOptions, setManagerOptions] = useState<EmployeeOption[]>([]);
  const [payStructureOptions, setPayStructureOptions] = useState<PayStructureOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy/v1/hrms/employees?limit=500")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data?: EmployeeOption[] } | EmployeeOption[]) => {
        if (cancelled) return;
        setManagerOptions(Array.isArray(body) ? body : (body.data ?? []));
      })
      .catch(() => { /* graceful fallback to text input */ });
    fetch("/api/proxy/v1/payroll/structures?limit=200")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data?: PayStructureOption[] } | PayStructureOption[]) => {
        if (cancelled) return;
        setPayStructureOptions(Array.isArray(body) ? body : (body.data ?? []));
      })
      .catch(() => { /* graceful fallback to text input */ });
    return () => { cancelled = true; };
  }, []);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("error");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const formError = useFormError("employee record");

  const ids = {
    mobile: `${formId}-mobile`,
    email: `${formId}-email`,
    managerId: `${formId}-managerId`,
    payStructureId: `${formId}-payStructureId`,
    status: `${formId}-status`,
    bankAccountNo: `${formId}-bankAccountNo`,
    bankIfsc: `${formId}-bankIfsc`,
    uanNumber: `${formId}-uanNumber`,
    esicIpNumber: `${formId}-esicIpNumber`,
    pran: `${formId}-pran`,
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const errs = new Set<string>();
    const trimmedEmail = email.trim();
    const trimmedMobile = mobile.trim();

    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) errs.add("email");
    if (trimmedMobile && !PHONE_RE.test(trimmedMobile)) errs.add("mobile");

    if (errs.size > 0) {
      setInvalidFields(errs);
      setTone("error");
      setMessage(t("fixHighlightedFields"));
      return;
    }

    setInvalidFields(new Set());

    const patch: Record<string, string> = {};
    if (trimmedMobile !== (employee.phone ?? "")) patch.mobile = trimmedMobile;
    if (trimmedEmail !== (employee.email ?? "")) patch.email = trimmedEmail;
    if (managerId.trim() !== (employee.reportingTo ?? ""))
      patch.managerId = managerId.trim();
    if (payStructureId.trim() !== "")
      patch.payStructureId = payStructureId.trim();
    // Data-corruption fix: bankAccountNo/bankIfsc arrive here pre-masked by
    // the backend (pii-mask.ts maskValue -- "*******1234"), and this state
    // was seeded directly from that masked value above. A plain non-empty
    // check therefore always included the masked placeholder in the patch,
    // even when the user never touched the field -- silently overwriting the
    // real stored bank account/IFSC with asterisks on every save, for any
    // reason (e.g. just correcting the email). Compare against the original
    // (masked) prop value instead, same "was this actually edited" pattern
    // already used for mobile/email/managerId above, so an untouched field
    // is never submitted.
    const initialBankAccountNo = (employee as Record<string, unknown>).bankAccountNo as string ?? "";
    const initialBankIfsc = (employee as Record<string, unknown>).bankIfsc as string ?? "";
    if (bankAccountNo.trim() !== initialBankAccountNo) patch.bankAccountNo = bankAccountNo.trim();
    if (bankIfsc.trim().toUpperCase() !== initialBankIfsc.toUpperCase()) patch.bankIfsc = bankIfsc.trim().toUpperCase();
    const initialUan = (employee as Record<string, unknown>).uanNumber as string ?? "";
    const initialEsic = (employee as Record<string, unknown>).esicIpNumber as string ?? "";
    const initialPran = (employee as Record<string, unknown>).pran as string ?? "";
    if (uanNumber.trim() !== initialUan) patch.uanNumber = uanNumber.trim();
    if (esicIpNumber.trim() !== initialEsic) patch.esicIpNumber = esicIpNumber.trim();
    if (pran.trim() !== initialPran) patch.pran = pran.trim();

    if (Object.keys(patch).length === 0) {
      setTone("error");
      setMessage(t("noChangesDetected"));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        return;
      }

      // PATCH /v1/hrms/employees/:id returns 202 (queued command) -- the
      // update is being applied, not already confirmed done.
      setTone("success");
      setMessage(t("updateSubmitted"));
      setTimeout(() => {
        router.push(`/hr/employees/${employee.id}`);
        router.refresh();
      }, 1200);
    } catch {
      setTone("error");
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label={t("formAriaLabel")}
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>{t("formHeading")}</h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut, #64748b)" }}>
          {t("formIntro")}
        </p>
      </div>

      <div className="pad" style={{ display: "grid", gap: 20 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={ids.status}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "var(--goodbg, #dcfce7)" : "var(--badbg, #fee2e2)",
                border: `1px solid ${tone === "success" ? "var(--goodbd, #86efac)" : "var(--badbd, #fca5a5)"}`,
                color: tone === "success" ? "var(--good, #166534)" : "var(--bad, #b91c1c)",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        {/* Read-only summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--bg, #f8fafc)",
            border: "1px solid var(--line, #cbd5e1)",
          }}
        >
          {[
            { label: t("roLabelEmployeeId"), value: employee.employeeId },
            { label: t("roLabelDepartment"), value: employee.department },
            { label: t("roLabelDesignation"), value: employee.designation },
            { label: t("roLabelStatus"), value: employee.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "var(--mut, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, color: "var(--ink, #0f172a)", fontWeight: 500 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Editable fields */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.mobile} style={labelStyle}>
              {t("mobileLabel")}
            </label>
            <input
              id={ids.mobile}
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder={t("mobilePlaceholder")}
              autoComplete="tel"
              aria-invalid={invalidFields.has("mobile")}
              style={{
                ...inputStyle,
                borderColor: invalidFields.has("mobile")
                  ? "var(--bad, #ef4444)"
                  : "var(--line, #cbd5e1)",
              }}
            />
            {formError.fieldError("mobile") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("mobile")}</span>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.email} style={labelStyle}>
              {t("emailLabel")}
            </label>
            <input
              id={ids.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              autoComplete="email"
              aria-invalid={invalidFields.has("email")}
              style={{
                ...inputStyle,
                borderColor: invalidFields.has("email")
                  ? "var(--bad, #ef4444)"
                  : "var(--line, #cbd5e1)",
              }}
            />
            {formError.fieldError("email") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("email")}</span>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.managerId} style={labelStyle}>
              {t("managerIdLabel")}
            </label>
            {managerOptions.length > 0 ? (
              <select
                id={ids.managerId}
                style={inputStyle}
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
              >
                <option value="">{t("selectManagerPlaceholder")}</option>
                {managerOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={ids.managerId}
                type="text"
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                placeholder={t("managerIdPlaceholder")}
                style={inputStyle}
              />
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.payStructureId} style={labelStyle}>
              {t("payStructureIdLabel")}
            </label>
            {payStructureOptions.length > 0 ? (
              <select
                id={ids.payStructureId}
                style={inputStyle}
                value={payStructureId}
                onChange={(e) => setPayStructureId(e.target.value)}
              >
                <option value="">{t("selectPayStructurePlaceholder")}</option>
                {payStructureOptions.map((ps) => (
                  <option key={ps.id} value={ps.id}>
                    {ps.name ?? ps.code ?? ps.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={ids.payStructureId}
                type="text"
                value={payStructureId}
                onChange={(e) => setPayStructureId(e.target.value)}
                placeholder={t("payStructureIdPlaceholder")}
                style={inputStyle}
              />
            )}
          </div>
        </div>


        {/* Statutory & Financial Details */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--ink)" }}>
            {t("statutoryHeading")}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.bankAccountNo} style={labelStyle}>{t("bankAccountLabel")}</label>
              <input id={ids.bankAccountNo} type="text" value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                placeholder={t("bankAccountPlaceholder")}
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.bankIfsc} style={labelStyle}>{t("bankIfscLabel")}</label>
              <input id={ids.bankIfsc} type="text" value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value)}
                placeholder={t("bankIfscPlaceholder")} maxLength={11}
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.uanNumber} style={labelStyle}>{t("uanLabel")}</label>
              <input id={ids.uanNumber} type="text" value={uanNumber}
                onChange={(e) => setUanNumber(e.target.value)}
                placeholder={t("uanPlaceholder")} maxLength={12}
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.esicIpNumber} style={labelStyle}>{t("esicLabel")}</label>
              <input id={ids.esicIpNumber} type="text" value={esicIpNumber}
                onChange={(e) => setEsicIpNumber(e.target.value)}
                placeholder={t("esicPlaceholder")}
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.pran} style={labelStyle}>{t("pranLabel")}</label>
              <input id={ids.pran} type="text" value={pran}
                onChange={(e) => setPran(e.target.value)}
                placeholder={t("pranPlaceholder")} maxLength={12}
                style={inputStyle} autoComplete="off" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 12 }}>
            {t("statutoryNote")}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? t("savingBtn") : t("saveChangesBtn")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push(`/hr/employees/${employee.id}`)}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {t("cancelBtn")}
          </Button>
        </div>
      </div>
    </form>
  );
}

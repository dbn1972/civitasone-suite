"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export function CreateLoanForm() {
  const t = useTranslations("createLoanForm");
  const router = useRouter();
  const [loanNo, setLoanNo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loanType, setLoanType] = useState("personal");
  const [principalRupees, setPrincipalRupees] = useState("");
  const [emiRupees, setEmiRupees] = useState("");
  const [tenureMonths, setTenureMonths] = useState("");
  const [interestRatePct, setInterestRatePct] = useState("0");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [loanNoInvalid, setLoanNoInvalid] = useState(false);
  const [empIdInvalid, setEmpIdInvalid] = useState(false);
  const [principalInvalid, setPrincipalInvalid] = useState(false);
  const [emiInvalid, setEmiInvalid] = useState(false);
  const [tenureInvalid, setTenureInvalid] = useState(false);

  const loanNoField = useId();
  const empIdField = useId();
  const typeField = useId();
  const principalField = useId();
  const emiField = useId();
  const tenureField = useId();
  const rateField = useId();
  const errId = useId();

  const loanNoRef = useRef<HTMLInputElement>(null);
  const empIdRef = useRef<HTMLInputElement>(null);
  const principalRef = useRef<HTMLInputElement>(null);
  const emiRef = useRef<HTMLInputElement>(null);
  const tenureRef = useRef<HTMLInputElement>(null);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const loanNoMissing = !loanNo.trim();
    const empIdMissing = !employeeId.trim();
    const principalMissing = !principalRupees;
    const emiMissing = !emiRupees;
    const tenureMissing = !tenureMonths;
    setLoanNoInvalid(loanNoMissing);
    setEmpIdInvalid(empIdMissing);
    setPrincipalInvalid(principalMissing);
    setEmiInvalid(emiMissing);
    setTenureInvalid(tenureMissing);
    if (loanNoMissing || empIdMissing || principalMissing || emiMissing || tenureMissing) {
      setError(t("requiredError"));
      if (loanNoMissing) {
        loanNoRef.current?.focus();
      } else if (empIdMissing) {
        empIdRef.current?.focus();
      } else if (principalMissing) {
        principalRef.current?.focus();
      } else if (emiMissing) {
        emiRef.current?.focus();
      } else {
        tenureRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function createLoan() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/payroll/loans", {
        method: "POST",
        body: JSON.stringify({
          loanNo: loanNo.trim(),
          employeeId: employeeId.trim(),
          loanType,
          principalMinor: Math.round(Number(principalRupees) * 100),
          emiMinor: Math.round(Number(emiRupees) * 100),
          tenureMonths: Number(tenureMonths),
          interestRatePct: Number(interestRatePct || "0"),
          currency: "INR",
        }),
      });
      setConfirmOpen(false);
      setMessage(t("submittedMessage", { loanNo, id: res.id }));
      setLoanNo("");
      setEmployeeId("");
      setPrincipalRupees("");
      setEmiRupees("");
      setTenureMonths("");
      setInterestRatePct("0");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title={t("cardTitle")} padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={loanNoField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("loanNoLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={loanNoField}
              ref={loanNoRef}
              value={loanNo}
              onChange={(e) => { setLoanNo(e.target.value); setLoanNoInvalid(false); }}
              maxLength={64}
              aria-required="true"
              aria-invalid={loanNoInvalid || undefined}
              aria-describedby={loanNoInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={empIdField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={empIdField}
              ref={empIdRef}
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); setEmpIdInvalid(false); }}
              aria-required="true"
              aria-invalid={empIdInvalid || undefined}
              aria-describedby={empIdInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={typeField} style={{ fontSize: 13, fontWeight: 600 }}>{t("loanTypeLabel")}</label>
            <select id={typeField} value={loanType} onChange={(e) => setLoanType(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}>
              <option value="personal">{t("optionPersonal")}</option>
              <option value="vehicle">{t("optionVehicle")}</option>
              <option value="house_building">{t("optionHouseBuilding")}</option>
              <option value="festival">{t("optionFestival")}</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={principalField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("principalLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={principalField}
              ref={principalRef}
              type="number"
              min={0}
              step="0.01"
              value={principalRupees}
              onChange={(e) => { setPrincipalRupees(e.target.value); setPrincipalInvalid(false); }}
              aria-required="true"
              aria-invalid={principalInvalid || undefined}
              aria-describedby={principalInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={emiField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("emiLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={emiField}
              ref={emiRef}
              type="number"
              min={0}
              step="0.01"
              value={emiRupees}
              onChange={(e) => { setEmiRupees(e.target.value); setEmiInvalid(false); }}
              aria-required="true"
              aria-invalid={emiInvalid || undefined}
              aria-describedby={emiInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={tenureField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("tenureLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={tenureField}
              ref={tenureRef}
              type="number"
              min={1}
              value={tenureMonths}
              onChange={(e) => { setTenureMonths(e.target.value); setTenureInvalid(false); }}
              aria-required="true"
              aria-invalid={tenureInvalid || undefined}
              aria-describedby={tenureInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={rateField} style={{ fontSize: 13, fontWeight: 600 }}>{t("interestRateLabel")}</label>
            <input id={rateField} type="number" min={0} step="0.01" value={interestRatePct} onChange={(e) => setInterestRatePct(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {t("submitButton")}
          </Button>
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("confirmDescription", {
          loanNo,
          employeeId,
          principal: principalRupees,
          emi: emiRupees,
          tenure: tenureMonths,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createLoan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

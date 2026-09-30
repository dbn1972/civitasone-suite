"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { useTranslations } from "next-intl";
import { rupeesToMinorString } from "@/lib/money";

type EmployeeOption = { id: string; name: string; department: string; status: string };

const CLAIM_TYPES = ["indoor", "outdoor", "reimbursement", "advance"] as const;
type ClaimType = (typeof CLAIM_TYPES)[number];
const DEPENDANT_RELATIONS = ["spouse", "child", "parent"] as const;
type DependantRelation = (typeof DEPENDANT_RELATIONS)[number];

/**
 * GAP-HR-MEDICAL-05 (money-adjacent — human review requested, see PR):
 * amount is a plain rupee input converted via lib/money.ts's
 * rupeesToMinorString (CLAUDE.md's paise rule), same helper the codebase's
 * other money-input forms already use — never a float/Math.round
 * conversion.
 */
export function NewMedicalClaimForm({
  employees,
  noLinkedProfile,
}: {
  employees: EmployeeOption[];
  noLinkedProfile: boolean;
}) {
  const t = useTranslations("medicalClaims");
  const router = useRouter();
  const singleEmployee = employees.length === 1 ? employees[0] : null;

  const [employeeId, setEmployeeId] = useState(singleEmployee?.id ?? "");
  const [claimType, setClaimType] = useState<ClaimType>("outdoor");
  const [amount, setAmount] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [dependantRelation, setDependantRelation] = useState<"" | DependantRelation>("");
  const [dependantName, setDependantName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (noLinkedProfile) {
    return <p className="pad">{t("noLinkedProfileMessage")}</p>;
  }

  async function submit() {
    setError(undefined);
    if (!employeeId) { setError(t("errorChooseEmployee")); return; }
    const amountMinor = rupeesToMinorString(amount);
    if (amountMinor == null) { setError(t("errorInvalidAmount")); return; }
    if (!hospitalName.trim()) { setError(t("errorHospitalRequired")); return; }
    if (!diagnosis.trim()) { setError(t("errorDiagnosisRequired")); return; }
    if (dependantRelation && !dependantName.trim()) { setError(t("errorDependantNameRequired")); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/proxy/v1/hrms/medical/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId,
          claimType,
          amountMinor: Number(amountMinor),
          hospitalName: hospitalName.trim(),
          diagnosis: diagnosis.trim(),
          documents: [],
          ...(dependantRelation ? { dependantRelation, dependantName: dependantName.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t("fileClaimFailedMessage"));
      }
      router.push("/hr/medical");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("fileClaimFailedMessage"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18, maxWidth: 560 }}>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        {employees.length > 1 && (
          <Field label={t("fieldEmployee")}>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{t("selectEmployeePlaceholder")}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
        )}
        {singleEmployee && (
          <p style={{ fontSize: "0.8125rem", color: "var(--mut)", margin: 0 }}>
            {t("filingForLabel", { name: singleEmployee.name })}
          </p>
        )}
        <Field label={t("fieldClaimType")}>
          <Select value={claimType} onChange={(e) => setClaimType(e.target.value as ClaimType)}>
            {CLAIM_TYPES.map((ct) => (
              <option key={ct} value={ct}>{t(`claimType.${ct}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("fieldHospital")}>
          <Input value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} />
        </Field>
        <Field label={t("fieldAmount")}>
          <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("fieldDiagnosis")}>
          <Textarea rows={3} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
        </Field>
        <Field label={t("fieldDependantRelation")}>
          <Select value={dependantRelation} onChange={(e) => setDependantRelation(e.target.value as "" | DependantRelation)}>
            <option value="">{t("claimantSelf")}</option>
            {DEPENDANT_RELATIONS.map((r) => (
              <option key={r} value={r}>{t(`dependantRelation.${r}`)}</option>
            ))}
          </Select>
        </Field>
        {dependantRelation && (
          <Field label={t("fieldDependantName")}>
            <Input value={dependantName} onChange={(e) => setDependantName(e.target.value)} />
          </Field>
        )}
        {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "0.8125rem", margin: 0 }}>{error}</p>}
        <div>
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? t("submitting") : t("submitClaim")}
          </Button>
        </div>
      </div>
    </div>
  );
}

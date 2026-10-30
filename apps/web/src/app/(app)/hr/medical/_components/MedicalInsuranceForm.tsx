"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Select } from "../../../../_components/ds";
import { minorToDecimalString, minorToSafeNumber, nonNegativeRupeesToMinorString } from "@/lib/money";
import {
  INSURANCE_DEPENDANT_RELATIONS, INSURANCE_SCHEME_TYPES, isDependantRelation, isSchemeType,
  type InsuranceDependantRelation, type InsuranceSchemeType, type MedicalInsurance,
} from "./insuranceTypes";

/** Same rule as the backend (insurance.ts idText): no "*", so a masked value can never be saved. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{3,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_ERRORS = ["VALIDATION_FAILED", "CARD_NUMBER_REQUIRED", "NOT_FOUND", "FORBIDDEN"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

type DependantDraft = { name: string; relation: InsuranceDependantRelation; dateOfBirth: string };

export type InsuranceFormErrors = Partial<Record<"schemeType" | "cardNumber" | "schemeId" | "validityFrom" | "validityTo" | "annualLimit" | "dependants", string>>;

/**
 * HR edit form for an employee's medical insurance: PUT (upsert) and DELETE
 * /v1/hrms/medical/insurance/:employeeId, both HR-only on the backend
 * (medical/routes.ts HR_ROLES == MEDICAL_INSURANCE_EDIT_ROLES). The page only
 * renders this for that tier.
 *
 * The card number / scheme id are never pre-filled: an existing record only
 * shows the current (possibly masked) value as a hint, and leaving the field
 * blank keeps what is stored. Writes are asynchronous (202), so success says
 * the change may take a moment to show.
 */
export function MedicalInsuranceForm({ employeeId, initial }: { employeeId: string; initial: MedicalInsurance | null }) {
  const t = useTranslations("medicalInsurance");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [schemeType, setSchemeType] = useState<InsuranceSchemeType>(
    initial && isSchemeType(initial.schemeType) ? initial.schemeType : "cghs",
  );
  const [cardNumber, setCardNumber] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [clearSchemeId, setClearSchemeId] = useState(false);
  const [validityFrom, setValidityFrom] = useState(initial?.validityFrom ?? "");
  const [validityTo, setValidityTo] = useState(initial?.validityTo ?? "");
  const [tier, setTier] = useState(initial?.tier ?? "");
  const [annualLimit, setAnnualLimit] = useState(initial?.annualLimitMinor ? (minorToDecimalString(initial.annualLimitMinor) ?? "") : "");
  const [dependants, setDependants] = useState<DependantDraft[]>(
    (initial?.dependants ?? []).map((d) => ({
      name: d.name ?? "",
      relation: isDependantRelation(d.relation) ? d.relation : "other",
      dateOfBirth: d.dateOfBirth ?? "",
    })),
  );
  const [errors, setErrors] = useState<InsuranceFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const isNew = initial === null;

  function validate(): InsuranceFormErrors {
    const e: InsuranceFormErrors = {};
    if (!isSchemeType(schemeType)) e.schemeType = t("errors.schemeType");
    const card = cardNumber.trim();
    if (isNew && !card) e.cardNumber = t("errors.cardNumberRequired");
    else if (card && !ID_RE.test(card)) e.cardNumber = t("errors.idFormat");
    const sid = schemeId.trim();
    if (sid && !ID_RE.test(sid)) e.schemeId = t("errors.idFormat");
    if (!DATE_RE.test(validityFrom)) e.validityFrom = t("errors.dateRequired");
    if (validityTo && !DATE_RE.test(validityTo)) e.validityTo = t("errors.dateFormat");
    else if (validityTo && DATE_RE.test(validityFrom) && validityTo < validityFrom) e.validityTo = t("errors.validityOrder");
    if (annualLimit.trim() && nonNegativeRupeesToMinorString(annualLimit) === null) e.annualLimit = t("errors.annualLimit");
    if (dependants.some((d) => !d.name.trim() || (d.dateOfBirth && !DATE_RE.test(d.dateOfBirth)))) e.dependants = t("errors.dependants");
    return e;
  }

  async function save() {
    setMessage(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const limitMinor = annualLimit.trim() ? minorToSafeNumber(nonNegativeRupeesToMinorString(annualLimit)) : null;
    const body: Record<string, unknown> = {
      schemeType,
      validityFrom,
      validityTo: validityTo || null,
      tier: tier.trim() || null,
      annualLimitMinor: limitMinor,
      dependants: dependants.map((d) => ({
        name: d.name.trim(), relation: d.relation, ...(d.dateOfBirth ? { dateOfBirth: d.dateOfBirth } : {}),
      })),
    };
    if (cardNumber.trim()) body.cardNumber = cardNumber.trim();
    if (schemeId.trim()) body.schemeId = schemeId.trim();
    else if (clearSchemeId) body.schemeId = null;

    await send("PUT", body);
  }

  async function remove() {
    if (!window.confirm(t("confirmDelete"))) return;
    setMessage(null);
    await send("DELETE");
  }

  async function send(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/medical/insurance/${encodeURIComponent(employeeId)}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        setMessage({ kind: "ok", text: method === "PUT" ? t("saved") : t("deleted") });
        setCardNumber("");
        setSchemeId("");
        setClearSchemeId(false);
        router.refresh();
        return;
      }
      const err = (await res.json().catch(() => null)) as { code?: string } | null;
      const code = err?.code;
      setMessage({
        kind: "error",
        text: code && (KNOWN_ERRORS as readonly string[]).includes(code) ? t(`errors.api.${code as KnownError}`) : t("errors.api.generic"),
      });
    } catch {
      setMessage({ kind: "error", text: t("errors.api.generic") });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <Button variant="ghost" onClick={() => setOpen(true)}>{isNew ? t("addButton") : t("editButton")}</Button>
      </div>
    );
  }

  return (
    <form
      aria-label={t("formLabel")}
      style={{ display: "grid", gap: 12, marginTop: 14, maxWidth: 560 }}
      onSubmit={(ev) => { ev.preventDefault(); void save(); }}
      noValidate
    >
      <Field label={t("fieldSchemeType")} required error={errors.schemeType}>
        <Select value={schemeType} onChange={(e) => setSchemeType(e.target.value as InsuranceSchemeType)}>
          {INSURANCE_SCHEME_TYPES.map((s) => <option key={s} value={s}>{t(`schemeType.${s}`)}</option>)}
        </Select>
      </Field>
      <Field label={t("fieldCardNumber")} required={isNew} error={errors.cardNumber}>
        <Input
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          autoComplete="off"
          placeholder={isNew ? "" : t("keepCurrentPlaceholder", { current: initial?.cardNumber ?? "—" })}
        />
      </Field>
      <Field label={t("fieldSchemeId")} error={errors.schemeId}>
        <Input
          value={schemeId}
          onChange={(e) => setSchemeId(e.target.value)}
          autoComplete="off"
          placeholder={!isNew && initial?.schemeId ? t("keepCurrentPlaceholder", { current: initial.schemeId }) : ""}
        />
      </Field>
      {!isNew && initial?.schemeId && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44, fontSize: 13 }}>
          <input type="checkbox" checked={clearSchemeId} onChange={(e) => setClearSchemeId(e.target.checked)} />
          {t("clearSchemeId")}
        </label>
      )}
      <Field label={t("fieldValidityFrom")} required error={errors.validityFrom}>
        <Input type="date" value={validityFrom} onChange={(e) => setValidityFrom(e.target.value)} />
      </Field>
      <Field label={t("fieldValidityTo")} error={errors.validityTo}>
        <Input type="date" value={validityTo} onChange={(e) => setValidityTo(e.target.value)} />
      </Field>
      <Field label={t("fieldTier")}>
        <Input value={tier} onChange={(e) => setTier(e.target.value)} maxLength={64} />
      </Field>
      <Field label={t("fieldAnnualLimitRupees")} error={errors.annualLimit}>
        <Input inputMode="decimal" placeholder="0.00" value={annualLimit} onChange={(e) => setAnnualLimit(e.target.value)} />
      </Field>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t("fieldDependants")}</legend>
        {dependants.map((d, i) => (
          <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", alignItems: "end" }}>
            <Field label={t("dependantName", { n: i + 1 })}>
              <Input value={d.name} onChange={(e) => setDependants((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </Field>
            <Field label={t("dependantRelation", { n: i + 1 })}>
              <Select value={d.relation} onChange={(e) => setDependants((all) => all.map((x, j) => (j === i ? { ...x, relation: e.target.value as InsuranceDependantRelation } : x)))}>
                {INSURANCE_DEPENDANT_RELATIONS.map((r) => <option key={r} value={r}>{t(`relation.${r}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("dependantDob", { n: i + 1 })}>
              <Input type="date" value={d.dateOfBirth} onChange={(e) => setDependants((all) => all.map((x, j) => (j === i ? { ...x, dateOfBirth: e.target.value } : x)))} />
            </Field>
            <Button variant="ghost" onClick={() => setDependants((all) => all.filter((_, j) => j !== i))}>{t("removeDependant")}</Button>
          </div>
        ))}
        {errors.dependants && <p role="alert" style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{errors.dependants}</p>}
        {dependants.length < 20 && (
          <div>
            <Button variant="ghost" onClick={() => setDependants((all) => [...all, { name: "", relation: "spouse", dateOfBirth: "" }])}>
              {t("addDependant")}
            </Button>
          </div>
        )}
      </fieldset>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t("saving") : t("saveButton")}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setOpen(false); setErrors({}); setMessage(null); }}>{t("cancelButton")}</Button>
        {!isNew && (
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>{t("deleteButton")}</Button>
        )}
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} style={{ margin: 0, fontSize: 13 }}>{message.text}</p>
      )}
    </form>
  );
}

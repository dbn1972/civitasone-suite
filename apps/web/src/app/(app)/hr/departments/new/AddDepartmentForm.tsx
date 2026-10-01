"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, EntityPicker } from "../../../../_components/ds";
import { eligibleParentOptions, type MinimalDept } from "@/lib/hr/departmentTree";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

interface Props {
  onCancel: () => void;
  onSuccess?: () => void;
  /**
   * GAP-HR-DEPARTMENTS-03: existing departments, for the optional "Parent
   * department" select -- without this the form could only ever create
   * top-level departments (parentId/level were never sent), so the tree
   * and "Sub-Departments" stat could never gain a node from the UI.
   * Optional (defaults to none) so this form still renders standalone in
   * isolation (e.g. existing unit tests that mount it with no other prop).
   */
  departments?: MinimalDept[];
}

const GOVT_TIERS = ["central", "state", "local_body", "statutory_body", "autonomous_body"] as const;
type GovtTier = (typeof GOVT_TIERS)[number];

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

export function AddDepartmentForm({ onCancel, onSuccess, departments = [] }: Props) {
  const t = useTranslations("addDepartmentForm");
  const formId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  // GAP-HR-DEPARTMENTS-NEW-01: Type / Govt tier / Head -- masters-routes.ts's
  // createDeptBody has always accepted these (type, govtTier, headEmployeeId)
  // and f3-consumer.ts's create/patch cases already persist them; only this
  // form never collected them. Location is deliberately still not here (no
  // location-service picker exists in this form yet -- see the gap's own fix
  // steps), so locationId is never sent.
  const [type, setType] = useState("");
  const [govtTier, setGovtTier] = useState<GovtTier | "">("");
  const [headEmployeeId, setHeadEmployeeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const formError = useFormError("department");
  const codeInputRef = useRef<HTMLInputElement>(null);

  const codeId = `${formId}-code`;
  const nameId = `${formId}-name`;
  const parentSelectId = `${formId}-parent`;
  const typeId = `${formId}-type`;
  const govtTierId = `${formId}-govtTier`;
  const statusId = `${formId}-status`;
  // Creating brand-new, so nothing to exclude beyond what's already there.
  const parentOptions = eligibleParentOptions(departments, null);

  // GAP-HR-DEPARTMENTS-NEW-04: Cancel used to discard typed values with no
  // confirmation. Low risk with just Code/Name, but grows now that this form
  // collects more (Parent, Type, Govt tier, Head) -- see GAP-HR-DEPARTMENTS-NEW-01.
  const isDirty =
    code.trim() !== "" ||
    name.trim() !== "" ||
    parentId !== "" ||
    type.trim() !== "" ||
    govtTier !== "" ||
    headEmployeeId !== null;

  function resetFields() {
    setCode("");
    setName("");
    setParentId("");
    setType("");
    setGovtTier("");
    setHeadEmployeeId(null);
    setMessage(null);
    setInvalid(new Set());
  }

  function handleCancel() {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onCancel();
  }

  function confirmDiscard() {
    resetFields();
    setShowDiscardConfirm(false);
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const trimCode = code.trim();
    const trimName = name.trim();
    const trimType = type.trim();
    const errs = new Set<string>();

    if (!trimCode || trimCode.length > 20) errs.add("code");
    if (trimName.length < 2 || trimName.length > 200) errs.add("name");
    if (trimType.length > 40) errs.add("type");

    if (errs.size > 0) {
      setInvalid(errs);
      setTone("error");
      setMessage(t("statusFixFields"));
      return;
    }

    setInvalid(new Set());
    setBusy(true);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/departments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: trimCode,
          name: trimName,
          // level is derived server-side from the chosen parent
          // (GAP-HR-DEPARTMENTS-03); never computed/sent from here.
          ...(parentId ? { parentId } : {}),
          ...(trimType ? { type: trimType } : {}),
          ...(govtTier ? { govtTier } : {}),
          ...(headEmployeeId ? { headEmployeeId } : {}),
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        return;
      }

      // resetFields() clears the message, so it must run BEFORE the success
      // message is set or the confirmation is wiped immediately.
      resetFields();
      setTone("success");
      setMessage(t("successMsg", { name: trimName }));
      // GAP-HR-DEPARTMENTS-NEW-03: return focus to Code so a clerk adding
      // several departments in a row can keep typing without reaching for
      // the mouse -- previously impossible anyway, since a forced redirect
      // tore the whole form down 1.5s after every single success.
      codeInputRef.current?.focus();
      onSuccess?.();
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
        <h3>{t("cardHeading")}</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={statusId}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "var(--goodbg, #dcfce7)" : "#fee2e2",
                border: `1px solid ${
                  tone === "success" ? "var(--goodbd, #86efac)" : "var(--badbd, #fca5a5)"
                }`,
                color: tone === "success" ? "var(--good, #166534)" : "var(--bad, #b91c1c)",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {/* Code */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={codeId} style={labelStyle}>
              {t("codeLabel")}{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #b91c1c)" }}>
                *
              </span>
            </label>
            <input
              ref={codeInputRef}
              id={codeId}
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("codePlaceholder")}
              maxLength={20}
              required
              aria-required="true"
              aria-invalid={invalid.has("code")}
              style={inputStyle}
            />
            {formError.fieldError("code") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("code")}</span>
            )}
          </div>

          {/* Name */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameId} style={labelStyle}>
              {t("nameLabel")}{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #b91c1c)" }}>
                *
              </span>
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={200}
              required
              aria-required="true"
              aria-invalid={invalid.has("name")}
              style={inputStyle}
            />
            {formError.fieldError("name") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("name")}</span>
            )}
          </div>

          {/* Parent department (GAP-HR-DEPARTMENTS-03) */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={parentSelectId} style={labelStyle}>
              {t("parentLabel")}
            </label>
            <select
              id={parentSelectId}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              aria-invalid={!!formError.fieldError("parentId")}
              style={inputStyle}
            >
              <option value="">{t("parentNone")}</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {formError.fieldError("parentId") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("parentId")}</span>
            )}
          </div>

          {/* Type (GAP-HR-DEPARTMENTS-NEW-01) */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={typeId} style={labelStyle}>
              {t("typeLabel")}
            </label>
            <input
              id={typeId}
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder={t("typePlaceholder")}
              maxLength={40}
              aria-invalid={invalid.has("type")}
              style={inputStyle}
            />
          </div>

          {/* Govt tier (GAP-HR-DEPARTMENTS-NEW-01) */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={govtTierId} style={labelStyle}>
              {t("govtTierLabel")}
            </label>
            <select
              id={govtTierId}
              value={govtTier}
              onChange={(e) => setGovtTier(e.target.value as GovtTier | "")}
              style={inputStyle}
            >
              <option value="">{t("govtTierNone")}</option>
              {GOVT_TIERS.map((gt) => (
                <option key={gt} value={gt}>{t(`govtTier_${gt}`)}</option>
              ))}
            </select>
          </div>

          {/* Head of department (GAP-HR-DEPARTMENTS-NEW-01) -- Location is
              deliberately NOT here: no location-service picker exists in
              this form yet (see the gap's own fix steps). */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={labelStyle}>{t("headLabel")}</label>
            <EntityPicker
              aria-label={t("headLabel")}
              value={headEmployeeId}
              onChange={(v) => setHeadEmployeeId(Array.isArray(v) ? v[0] ?? null : v)}
              search={searchEmployees}
              resolve={resolveEmployees}
              placeholder={t("headPlaceholder")}
              noResultsText={t("headNoResults")}
              searchingText={t("headSearching")}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="submit"
            loading={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? t("addingBtn") : t("addBtn")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {t("cancelBtn")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title={t("discardConfirmTitle")}
        confirmLabel={t("discardConfirmBtn")}
        danger
        onConfirm={confirmDiscard}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </form>
  );
}

"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EntityPicker, type EntityOption } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { DDO_CODE_RE, departmentLabel, diffDdoMapping, isUuid, type DdoRecord, type DepartmentOption } from "./ddoData";

type Props = {
  /** Every DDO and its current department set (for the save diff). */
  existing: DdoRecord[];
  /** hrms department master. */
  departments: DepartmentOption[];
  departmentsAvailable: boolean;
  /** Prefill for "edit" (code is then read-only). */
  editing?: DdoRecord;
};

export function CreateDdoForm({ existing, departments, departmentsAvailable, editing }: Props) {
  const t = useTranslations("createDdoForm");
  const router = useRouter();
  const [ddoCode, setDdoCode] = useState(editing?.ddoCode ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [departmentIds, setDepartmentIds] = useState<string[]>(editing?.departmentIds ?? []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);

  const codeField = useId();
  const nameField = useId();
  const deptField = useId();
  const errId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const options: EntityOption[] = useMemo(
    () => departments.map((d) => ({ id: d.id, label: d.name, sublabel: d.code || undefined })),
    [departments],
  );
  const label = (id: string) => departmentLabel(id, deptMap);
  const diff = diffDdoMapping(ddoCode, departmentIds, existing);

  // GAP-PAYROLL-DDOS-01: departments come only from the hrms master via the
  // picker; a free-typed id can no longer reach the API.
  async function searchDepartments(query: string): Promise<EntityOption[]> {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q)) : options;
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const code = ddoCode.trim();
    const codeMissing = !code;
    const codeMalformed = !codeMissing && !DDO_CODE_RE.test(code);
    const nameMissing = !name.trim();
    setCodeInvalid(codeMissing || codeMalformed);
    setNameInvalid(nameMissing);
    if (codeMissing || nameMissing) {
      setError(t("codeNameRequiredError"));
      if (codeMissing) codeRef.current?.focus();
      else nameRef.current?.focus();
      return;
    }
    // GAP-PAYROLL-DDOS-05: format check on the code (no spaces etc.).
    if (codeMalformed) {
      setError(t("codeFormatError"));
      codeRef.current?.focus();
      return;
    }
    if (!departmentIds.every(isUuid)) {
      setError(t("departmentInvalidError"));
      return;
    }
    setConfirmOpen(true);
  }

  async function save(reason?: string) {
    setBusy(true);
    setError(undefined);
    const code = ddoCode.trim();
    const trimmedName = name.trim();
    try {
      // 202 + command id: the API does not echo the DDO back, so the
      // confirmation uses the submitted values.
      await browserJson<unknown>("v1/payroll/ddos", {
        method: "POST",
        body: JSON.stringify({ ddoCode: code, name: trimmedName, departmentIds, reason }),
      });
      setConfirmOpen(false);
      setMessage(t("savedMessage", { code, name: trimmedName }));
      if (!editing) {
        setDdoCode("");
        setName("");
        setDepartmentIds([]);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  const listOrNone = (ids: string[]) => (ids.length ? ids.map(label).join(", ") : t("diffNone"));

  return (
    <form onSubmit={openConfirm} noValidate style={{ marginBottom: 16 }}>
      <Card title={editing ? t("editFormTitle", { code: editing.ddoCode }) : t("formTitle")} padding>
        {!departmentsAvailable && (
          <p role="alert" className="pill warn" style={{ width: "fit-content", marginTop: 0 }}>{t("departmentsUnavailable")}</p>
        )}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={codeField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("ddoCodeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={codeField}
              ref={codeRef}
              value={ddoCode}
              onChange={(e) => { setDdoCode(e.target.value); setCodeInvalid(false); }}
              readOnly={!!editing}
              maxLength={32}
              aria-required="true"
              aria-invalid={codeInvalid || undefined}
              aria-describedby={codeInvalid ? errId : undefined}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("nameLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={nameField}
              ref={nameRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setNameInvalid(false); }}
              maxLength={200}
              aria-required="true"
              aria-invalid={nameInvalid || undefined}
              aria-describedby={nameInvalid ? errId : undefined}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={deptField} style={{ fontSize: 13, fontWeight: 600 }}>{t("departmentsLabel")}</label>
            <EntityPicker
              id={deptField}
              multiple
              value={departmentIds}
              onChange={(v) => setDepartmentIds(Array.isArray(v) ? v : v ? [v] : [])}
              search={searchDepartments}
              initialOptions={options}
              minQueryLength={0}
              disabled={!departmentsAvailable}
              placeholder={t("departmentsPlaceholder")}
              noResultsText={t("departmentsNoResults")}
              removeOptionAriaLabel={(l) => t("removeDepartment", { name: l })}
            />
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {editing ? t("updateDdoBtn") : t("saveDdoBtn")}
          </Button>
          {editing && (
            <Link href="/hr/payroll/ddos" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>{t("cancelEdit")}</Link>
          )}
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      {/* GAP-PAYROLL-DDOS-02: show exactly what the save changes and require
          a reason (recorded in the audit event). */}
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              {t.rich(diff.isUpdate ? "confirmDescriptionUpdate" : "confirmDescriptionNew", {
                ddoCode: ddoCode.trim(),
                name: name.trim(),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
              <li>{t("diffAdded", { list: listOrNone(diff.added) })}</li>
              {diff.isUpdate && <li>{t("diffRemoved", { list: listOrNone(diff.removed) })}</li>}
              {[...diff.movedFrom.entries()].map(([id, from]) => (
                <li key={id}>{t("diffMoved", { department: label(id), from })}</li>
              ))}
            </ul>
          </>
        }
        onConfirm={(reason) => void save(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

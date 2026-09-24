"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../../_components/ds";

interface Props {
  onCancel: () => void;
  onSuccess?: () => void;
}

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

export function AddDepartmentForm({ onCancel, onSuccess }: Props) {
  const t = useTranslations("addDepartmentForm");
  const formId = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const formError = useFormError("department");

  const codeId = `${formId}-code`;
  const nameId = `${formId}-name`;
  const statusId = `${formId}-status`;

  function handleCancel() {
    setCode("");
    setName("");
    setMessage(null);
    setInvalid(new Set());
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const trimCode = code.trim();
    const trimName = name.trim();
    const errs = new Set<string>();

    if (!trimCode || trimCode.length > 20) errs.add("code");
    if (trimName.length < 2 || trimName.length > 200) errs.add("name");

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
        body: JSON.stringify({ code: trimCode, name: trimName }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        return;
      }

      setTone("success");
      setMessage(t("successMsg", { name: trimName }));
      setCode("");
      setName("");
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
    </form>
  );
}

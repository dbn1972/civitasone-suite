"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Card } from "../../../_components/ds";

type Row = { id: string; label: string; status?: string };

const LOCATION_TYPES = ["state", "district", "block", "ward", "office", "facility", "branch"] as const;

const inputStyle = {
  width: "100%",
  minHeight: 44,
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
} as const;

const fieldCol = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  marginBottom: 12,
};

const fieldErrorStyle = {
  fontSize: 12,
  color: "var(--danger, #b91c1c)",
} as const;

/**
 * Create form for /locations/list (GAP-LOCATIONS-LIST-01/03/05). Archiving lives
 * on each table row (LocationsListTable), so there is one place to do it.
 */
export function LocationActions({ rows }: { rows: Row[] }) {
  const t = useTranslations("locationsList");
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("office");
  const [lgdCode, setLgdCode] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formError = useFormError("location");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const parentOptions = rows.filter((r) => r.status !== "archived");

  function fieldErr(field: string): string | undefined {
    return fieldErrors[field];
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    setFieldErrors({});
    try {
      const res = await fetch("/api/proxy/v1/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          lgdCode: lgdCode || undefined,
          parentId: parentId || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setFieldErrors(resolved.fieldErrors);
        setError(resolved.message);
        return;
      }
      setName("");
      setLgdCode("");
      setParentId("");
      setType("office");
      setSuccess(t("added"));
      // Return focus to the first field so keyboard users can add another; the
      // polite status region below announces the success.
      nameRef.current?.focus();
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const nameErr = fieldErr("name");
  const typeErr = fieldErr("type");
  const lgdErr = fieldErr("lgdCode");
  const parentErr = fieldErr("parentId");

  return (
    <div style={{ marginBottom: 18 }}>
      <Card title={t("formTitle")}>
        <form className="pad" onSubmit={create}>
          <div style={fieldCol}>
            <label className="l" htmlFor="loc-name">{t("nameLabel")}</label>
            <input
              id="loc-name"
              ref={nameRef}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              aria-invalid={nameErr ? true : undefined}
              aria-describedby={nameErr ? "loc-name-err" : undefined}
            />
            {nameErr ? (
              <span id="loc-name-err" role="alert" style={fieldErrorStyle}>{nameErr}</span>
            ) : null}
          </div>

          <div style={fieldCol}>
            <label className="l" htmlFor="loc-type">{t("typeLabel")}</label>
            <select
              id="loc-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={inputStyle}
              aria-invalid={typeErr ? true : undefined}
              aria-describedby={typeErr ? "loc-type-err" : undefined}
            >
              {LOCATION_TYPES.map((value) => (
                <option key={value} value={value}>{t(`types.${value}`)}</option>
              ))}
            </select>
            {typeErr ? (
              <span id="loc-type-err" role="alert" style={fieldErrorStyle}>{typeErr}</span>
            ) : null}
          </div>

          <div style={fieldCol}>
            <label className="l" htmlFor="loc-parent">{t("parentLabel")}</label>
            <select
              id="loc-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              style={inputStyle}
              aria-invalid={parentErr ? true : undefined}
              aria-describedby={parentErr ? "loc-parent-err" : undefined}
            >
              <option value="">{t("parentNone")}</option>
              {parentOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {parentErr ? (
              <span id="loc-parent-err" role="alert" style={fieldErrorStyle}>{parentErr}</span>
            ) : null}
          </div>

          <div style={fieldCol}>
            <label className="l" htmlFor="loc-lgd">{t("lgdLabel")}</label>
            <input
              id="loc-lgd"
              value={lgdCode}
              inputMode="numeric"
              onChange={(e) => setLgdCode(e.target.value)}
              style={inputStyle}
              aria-invalid={lgdErr ? true : undefined}
              aria-describedby={lgdErr ? "loc-lgd-err" : undefined}
            />
            {lgdErr ? (
              <span id="loc-lgd-err" role="alert" style={fieldErrorStyle}>{lgdErr}</span>
            ) : null}
          </div>

          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? t("saving") : t("submit")}
          </button>

          {error ? (
            <p
              role="alert"
              aria-live="assertive"
              style={{ minHeight: 18, marginTop: 8, fontSize: 12, color: "var(--danger, #b91c1c)" }}
            >
              {error}
            </p>
          ) : (
            <p
              role="status"
              aria-live="polite"
              style={{ minHeight: 18, marginTop: 8, fontSize: 12, color: "var(--ok, #15803d)" }}
            >
              {success}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

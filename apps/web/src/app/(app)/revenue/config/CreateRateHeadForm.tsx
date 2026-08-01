"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import type { AcceptedResponse } from "./types";

type InvalidField = "code" | "name" | "category" | null;

export function CreateRateHeadForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrorText, setFieldErrorText] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const codeId = useId();
  const nameId = useId();
  const categoryId = useId();
  const uomId = useId();
  const codeErrId = useId();
  const nameErrId = useId();
  const categoryErrId = useId();
  const successId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);
    if (!code.trim()) {
      setInvalidField("code");
      setFieldErrorText("Rate head code is required.");
      codeRef.current?.focus();
      return;
    }
    if (!name.trim()) {
      setInvalidField("name");
      setFieldErrorText("Rate head name is required.");
      nameRef.current?.focus();
      return;
    }
    if (!category.trim()) {
      setInvalidField("category");
      setFieldErrorText("Category is required.");
      categoryRef.current?.focus();
      return;
    }
    setInvalidField(null);
    setFieldErrorText(null);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createRateHead() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/rate-heads", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          category: category.trim(),
          unitOfMeasure: unitOfMeasure.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setSuccessMessage(
        res.id
          ? `Rate head submitted (id ${res.id}). It is processed asynchronously and will appear in the list shortly.`
          : "Rate head submitted.",
      );
      setCode("");
      setName("");
      setCategory("");
      setUnitOfMeasure("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Rate Head" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={codeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={codeId}
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={32}
                aria-required="true"
                aria-invalid={invalidField === "code" || undefined}
                aria-describedby={invalidField === "code" ? codeErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "code" && fieldErrorText && (
                <p id={codeErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                Name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={nameId}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                aria-required="true"
                aria-invalid={invalidField === "name" || undefined}
                aria-describedby={invalidField === "name" ? nameErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "name" && fieldErrorText && (
                <p id={nameErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={categoryId} style={{ fontSize: 13, fontWeight: 600 }}>
                Category <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={categoryId}
                ref={categoryRef}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={48}
                placeholder="e.g. property_tax, water, sewerage"
                aria-required="true"
                aria-invalid={invalidField === "category" || undefined}
                aria-describedby={invalidField === "category" ? categoryErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "category" && fieldErrorText && (
                <p id={categoryErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={uomId} style={{ fontSize: 13, fontWeight: 600 }}>Unit of Measure</label>
              <input
                id={uomId}
                value={unitOfMeasure}
                onChange={(e) => setUnitOfMeasure(e.target.value)}
                maxLength={32}
                placeholder="e.g. sq_ft"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Rate Head
            </button>
          </div>

          {successMessage && (
            <p id={successId} role="status" aria-live="polite" className="pill good" style={{ width: "fit-content" }}>
              {successMessage}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this rate head?"
        confirmLabel="Create rate head"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create rate head <strong>{code}</strong> — {name} ({category}).
          </>
        }
        onConfirm={() => void createRateHead()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

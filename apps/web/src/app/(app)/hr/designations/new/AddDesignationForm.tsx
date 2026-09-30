"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useFormError } from "@/lib/useFormError";
import { useZodFieldValidation } from "@/lib/form-validation";
import { MAX_PAY_LEVEL, MIN_PAY_LEVEL, payLevelSchema } from "@/lib/payLevels";
import { Button, Field, Input } from "../../../../_components/ds";

interface Props {
  onCancel: () => void;
  onSuccess?: () => void;
}

/**
 * SF-14 migration: this form used to hand-roll its own label/input/error
 * markup and a manual `Set<string>` of invalid fields (see git history for
 * the pre-migration version). It now uses the shared `Field`/`Input`
 * primitives (app/_components/ds) and a zod schema via
 * `useZodFieldValidation` (lib/form-validation.ts) as the proof that both
 * genuinely replace what hand-rolled hr/ forms did today -- not just in
 * isolation.
 *
 * The schema mirrors the exact rules the original hand-rolled version
 * enforced (code required, <=20 chars; name 2-200 chars; level, if given, a
 * clean positive-integer string; payGrade <=30 chars), so this migration is
 * behavior-preserving: same validation outcomes, same request body shape.
 * `level`/`payGrade` stay valid when empty -- both are optional, matching
 * the request body only including them `if (trimLevel)` / `if
 * (trimPayGrade)` below, exactly as before.
 */
const designationSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required.")
    .max(20, "Must be at most 20 characters."),
  name: z
    .string()
    .trim()
    .min(2, "Must be at least 2 characters.")
    .max(200, "Must be at most 200 characters."),
  level: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[1-9]\d*$/.test(v), {
      message: "Enter a whole number of 1 or more.",
    })
    // GAP-HR-DESIGNATIONS-01: the 7th CPC pay matrix only defines levels
    // 1-18 (payLevels.ts) — previously unbounded, so e.g. "40" saved
    // successfully and rendered as an unclassifiable "—" everywhere.
    .refine((v) => v === "" || payLevelSchema.safeParse(Number(v)).success, {
      message: `Enter a level between ${MIN_PAY_LEVEL} and ${MAX_PAY_LEVEL}.`,
    }),
  payGrade: z.string().trim().max(30, "Must be at most 30 characters."),
});

export function AddDesignationForm({ onCancel, onSuccess }: Props) {
  const t = useTranslations("addDesignationForm");
  const formId = useId();
  const { fields, validate, reset } = useZodFieldValidation(designationSchema);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const formError = useFormError("designation");

  const statusId = `${formId}-status`;

  function handleCancel() {
    reset();
    setMessage(null);
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    if (!validate()) {
      setTone("error");
      setMessage(t("statusFixFields"));
      return;
    }

    const trimCode = fields.code.value.trim();
    const trimName = fields.name.value.trim();
    const trimLevel = fields.level.value.trim();
    const trimPayGrade = fields.payGrade.value.trim();

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        code: trimCode,
        name: trimName,
      };
      if (trimLevel) body.level = parseInt(trimLevel, 10);
      if (trimPayGrade) body.payGrade = trimPayGrade;

      const res = await fetch("/api/proxy/v1/hrms/designations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        return;
      }

      setTone("success");
      setMessage(t("successMsg", { name: trimName }));
      reset();
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
          <Field
            label={t("codeLabel")}
            required
            // A backend rejection (e.g. a duplicate code) takes priority over a
            // stale client-side message once both could apply.
            error={formError.fieldError("code") || fields.code.error}
          >
            <Input
              value={fields.code.value}
              onChange={fields.code.onChange}
              onBlur={fields.code.onBlur}
              placeholder={t("codePlaceholder")}
              maxLength={20}
            />
          </Field>

          {/* Name */}
          <Field
            label={t("nameLabel")}
            required
            error={formError.fieldError("name") || fields.name.error}
          >
            <Input
              value={fields.name.value}
              onChange={fields.name.onChange}
              onBlur={fields.name.onBlur}
              placeholder={t("namePlaceholder")}
              maxLength={200}
            />
          </Field>

          {/* Level */}
          <Field label={t("levelLabel")} error={formError.fieldError("level") || fields.level.error}>
            <Input
              type="number"
              min={MIN_PAY_LEVEL}
              max={MAX_PAY_LEVEL}
              step={1}
              value={fields.level.value}
              onChange={fields.level.onChange}
              onBlur={fields.level.onBlur}
              placeholder={t("levelPlaceholder")}
            />
          </Field>

          {/* Pay Grade */}
          <Field
            label={t("payGradeLabel")}
            error={formError.fieldError("payGrade") || fields.payGrade.error}
          >
            <Input
              value={fields.payGrade.value}
              onChange={fields.payGrade.onChange}
              onBlur={fields.payGrade.onBlur}
              placeholder={t("payGradePlaceholder")}
              maxLength={30}
            />
          </Field>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button type="submit" loading={busy} style={{ minHeight: 44, minWidth: 140 }}>
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

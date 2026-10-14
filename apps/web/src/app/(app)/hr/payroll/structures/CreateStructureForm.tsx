"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// next-intl / ICU MessageFormat: `select` compares the interpolated value
// after string coercion, so passing the raw `isDefault` boolean works with
// case labels "true"/"other" -- this composes the whole sentence as one
// translatable unit instead of concatenating a fixed-position suffix, so a
// Hindi (or any other locale) translation can reorder the clause naturally.
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, AcceptedNotice, Field, Input } from "../../../../_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { browserJson } from "@/lib/api/browserClient";
import { translateHrErrors } from "../../_components/translateHrErrors";
import { validateStructure, type StructureErrors } from "./structureSchema";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export function CreateStructureForm() {
  const t = useTranslations("createStructureForm");
  const tv = useTranslations("hrFormErrors2");
  const router = useRouter();
  const accepted = useAcceptedWrite();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const nameId = useId();
  const descId = useId();
  const defaultId = useId();
  const errId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<StructureErrors>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errs = translateHrErrors(validateStructure({ name, description }), tv);
    setErrors(errs);
    if (errs.name || errs.description) {
      setTone("bad");
      setMessage(name.trim() ? null : t("nameRequiredError"));
      nameRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createStructure() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/payroll/structures", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isDefault,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? t("submittedWithIdMessage", { id: res.id })
          : t("submittedMessage"),
      );
      setName("");
      setDescription("");
      setIsDefault(false);
      router.refresh();
      // GAP-PAYROLL-STRUCTURES-05: creation is async (202 + consumer), so the
      // first refresh can race it. Refresh once more shortly after.
      void accepted.accept();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <AcceptedNotice {...accepted.noticeProps} />
      <Card title={t("formTitle")} padding>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <Field id={nameId} label={t("nameLabel")} required error={errors.name}>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
            />
          </Field>
          <Field id={descId} label={t("descriptionLabel")} error={errors.description}>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
              <input
                id={defaultId}
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              {t("setAsDefaultLabel")}
            </label>
          </div>
        </div>

        <div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {t("createStructureBtn")}
          </Button>
        </div>

        {message && (
          <p
            id={errId}
            role={tone === "bad" ? "alert" : "status"}
            aria-live={tone === "bad" ? "assertive" : "polite"}
            className={`pill ${tone}`}
            style={{ width: "fit-content" }}
          >
            {message}
          </p>
        )}
      </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t.rich("confirmDescription", {
          name,
          // ICU `select` compares this after string coercion; t.rich()'s own
          // type only accepts string/number/Date values, not boolean, so
          // stringify explicitly rather than relying on an implicit cast.
          isDefault: isDefault ? "true" : "false",
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createStructure()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}

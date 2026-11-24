"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, Button, EntityPicker, Field } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import {
  searchInspectionEntities,
  resolveInspectionEntities,
  searchInspectionTypes,
  resolveInspectionTypes,
} from "@/lib/entityAdapters/inspectionAssign";

/**
 * Schedule an inspection: POST /v1/inspection/inspections
 * body { entityId, inspectionTypeId, planId?, assignedInspectors: uuid[] } (execution/routes.ts createSchema).
 * Before this form nothing in the UI could create an inspection, so the assignment form and the report
 * form (both need an existing inspection) could never be reached on a fresh office. The write is a 202:
 * the row appears in the list asynchronously, so we show the shared AcceptedNotice, never a fake success.
 */
export function NewInspectionForm() {
  const t = useTranslations("inspectionIntake");
  const router = useRouter();
  const formError = useFormError("inspection");
  const accepted = useAcceptedWrite();
  const [entityId, setEntityId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [inspectors, setInspectors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId || !typeId) {
      setError(t("scheduleRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/inspection/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, inspectionTypeId: typeId, assignedInspectors: inspectors }),
      });
      if (res.status !== 202 && !res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      accepted.accept();
      setEntityId(null);
      setTypeId(null);
      setInspectors([]);
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void submit(e)} noValidate aria-label={t("scheduleTitle")} style={{ marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("scheduleTitle")}</h2>
      <div className="fields">
        <Field id="new-insp-entity" label={t("entityLabel")} required>
          <EntityPicker
            value={entityId}
            onChange={(v) => setEntityId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={searchInspectionEntities}
            resolve={resolveInspectionEntities}
            disabled={busy}
            minQueryLength={1}
            aria-label={t("entityLabel")}
            placeholder={t("entityPlaceholder")}
          />
        </Field>
        <Field id="new-insp-type" label={t("typeLabel")} required>
          <EntityPicker
            value={typeId}
            onChange={(v) => setTypeId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={searchInspectionTypes}
            resolve={resolveInspectionTypes}
            disabled={busy}
            minQueryLength={1}
            aria-label={t("typeLabel")}
            placeholder={t("typePlaceholder")}
          />
        </Field>
        <Field id="new-insp-inspectors" label={t("inspectorsLabel")}>
          <EntityPicker
            multiple
            value={inspectors}
            onChange={(v) => setInspectors(Array.isArray(v) ? v : v ? [v] : [])}
            search={searchDirectoryUsers}
            resolve={resolveDirectoryUsers}
            disabled={busy}
            minQueryLength={1}
            aria-label={t("inspectorsLabel")}
            placeholder={t("inspectorsPlaceholder")}
          />
        </Field>
      </div>
      <div role="status" aria-live="polite">
        {error ? <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: "var(--bad)" }}>{error}</p> : null}
      </div>
      <AcceptedNotice {...accepted.noticeProps} message={t("scheduleAccepted")} />
      <div style={{ marginTop: 12 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? t("scheduling") : t("scheduleSubmit")}
        </Button>
      </div>
    </form>
  );
}

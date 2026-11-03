"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, ActionButton, Button, Field, Input, Select, Textarea } from "@/app/_components/ds";
import { UserFacingError } from "@/lib/userFacingError";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { OBSERVATION_SEVERITIES, SEVERITY_KEYS } from "../reportMeta";

/**
 * UAT Phase 2 C3 (J13): the report workflow actions — Submit (draft), Approve
 * (submitted; never by the report's maker — the service re-checks under a row
 * lock) and Add observation (draft / submitted). Every call is a 202: the page
 * shows "received" and a manual refresh, never a fake success.
 */
export function ReportActions({
  reportId,
  canSubmit,
  canApprove,
  isOwnReport,
  canObserve,
}: {
  reportId: string;
  canSubmit: boolean;
  canApprove: boolean;
  isOwnReport: boolean;
  canObserve: boolean;
}) {
  const t = useTranslations("inspectionReports");
  const router = useRouter();
  const formError = useFormError("inspection report");
  const accepted = useAcceptedWrite();
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState<string>("minor");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  async function post(action: "submit" | "approve" | "observations", body?: Record<string, unknown>) {
    const res = await fetch(`/api/proxy/v1/inspection/reports/${encodeURIComponent(reportId)}/${action}`, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 202 && !res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
  }

  async function transition(action: "submit" | "approve") {
    setError("");
    try {
      await post(action);
      accepted.accept();
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
      throw err;
    }
  }

  async function addObservation(e: React.FormEvent) {
    e.preventDefault();
    if (!category.trim() || !description.trim()) {
      setError(t("observationRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await post("observations", {
        category: category.trim(),
        severity,
        description: description.trim(),
        ...(location.trim() ? { location: location.trim() } : {}),
      });
      setCategory("");
      setDescription("");
      setLocation("");
      accepted.accept();
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {canSubmit ? (
          <ActionButton
            label={t("submitLabel")}
            className="btn primary"
            confirmTitle={t("submitConfirmTitle")}
            confirmDescription={t("submitConfirmDescription")}
            confirmLabel={t("submitLabel")}
            onConfirm={() => transition("submit")}
          />
        ) : null}
        {canApprove && !isOwnReport ? (
          <ActionButton
            label={t("approveLabel")}
            className="btn primary"
            confirmTitle={t("approveConfirmTitle")}
            confirmDescription={t("approveConfirmDescription")}
            confirmLabel={t("approveLabel")}
            onConfirm={() => transition("approve")}
          />
        ) : null}
        {canApprove && isOwnReport ? (
          <p role="note" style={{ margin: 0, fontSize: 14, color: "var(--ink2)" }}>{t("ownReportNote")}</p>
        ) : null}
      </div>
      <AcceptedNotice {...accepted.noticeProps} />
      {error ? <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--bad)" }}>{error}</p> : null}
      {canObserve ? (
        <form onSubmit={(e) => void addObservation(e)} noValidate aria-label={t("addObservation")}>
          <h3 style={{ margin: "8px 0" }}>{t("addObservation")}</h3>
          <div className="fields">
            <Field id="obs-category" label={t("categoryLabel")} required>
              <Input value={category} maxLength={64} onChange={(e) => setCategory(e.target.value)} />
            </Field>
            <Field id="obs-severity" label={t("severityLabel")}>
              <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {OBSERVATION_SEVERITIES.map((s) => <option key={s} value={s}>{t(SEVERITY_KEYS[s]!)}</option>)}
              </Select>
            </Field>
            <Field id="obs-location" label={t("locationLabel")}>
              <Input value={location} maxLength={256} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field id="obs-description" label={t("descriptionLabel")} required style={{ gridColumn: "1 / -1" }}>
              <Textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="ghost" style={{ marginTop: 8, minHeight: 44 }} disabled={saving}>{t("saveObservation")}</Button>
        </form>
      ) : null}
    </div>
  );
}

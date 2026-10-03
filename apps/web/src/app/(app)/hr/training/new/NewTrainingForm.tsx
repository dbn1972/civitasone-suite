"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useFormError } from "@/lib/useFormError";
import { useZodFieldValidation } from "@/lib/form-validation";
import { Button, Field, Input, Select } from "../../../../_components/ds";

/**
 * GAP-HR-TRAINING-NEW-03/05: schema mirrors the server's createTrainingBody
 * (services/hrms-service/src/modules/training/validators.ts) for the
 * per-field checks; useZodFieldValidation validates each field
 * independently as a string (see lib/form-validation.ts's own doc comment
 * and hr/designations/new/AddDesignationForm.tsx for the pattern this
 * mirrors) -- cross-field rules (toDate >= fromDate, deadline <= fromDate)
 * are NOT expressible per-field this way, so they're checked separately in
 * handleSubmit, same as the original hand-rolled version already did for
 * toDate >= fromDate.
 */
const trainingFormSchema = z.object({
  title: z.string().trim().min(1, "required").max(256, "tooLong"),
  venue: z.string().trim().max(256, "tooLong"),
  fromDate: z.string().trim().min(1, "required").regex(/^\d{4}-\d{2}-\d{2}$/, "invalid"),
  toDate: z.string().trim().min(1, "required").regex(/^\d{4}-\d{2}-\d{2}$/, "invalid"),
  facilitator: z.string().trim().max(256, "tooLong"),
  // GAP-HR-TRAINING-NEW-03: kept a string (matching AddDesignationForm's
  // "level" field convention) and refined to a clean positive-integer
  // pattern -- Number('') would otherwise coerce to 0 (already guarded
  // separately below) and "2.5" would otherwise pass a bare Number() check.
  maxParticipants: z.string().trim().refine((v) => /^[1-9]\d*$/.test(v), "invalidInt"),
});

type CategoryValue = "" | "mandatory" | "optional" | "leadership";
type ModeValue = "" | "online" | "classroom" | "blended";

function todayInIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function NewTrainingForm() {
  const t = useTranslations("trainingNew");
  const tTraining = useTranslations("training");
  const router = useRouter();
  const formError = useFormError("training program");
  const { fields, validate, values } = useZodFieldValidation(trainingFormSchema);

  const [category, setCategory] = useState<CategoryValue>("");
  const [mode, setMode] = useState<ModeValue>("");
  const [enrollmentDeadline, setEnrollmentDeadline] = useState("");
  const [crossFieldError, setCrossFieldError] = useState<{ toDate?: string; enrollmentDeadline?: string }>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const statusMsgId = useId();

  const isDirty = useMemo(
    () =>
      Object.values(values).some((v) => v.trim() !== "") ||
      category !== "" || mode !== "" || enrollmentDeadline !== "",
    [values, category, mode, enrollmentDeadline],
  );

  // GAP-HR-TRAINING-NEW-05: warn (don't silently lose) a tab close/refresh
  // with unsaved input. Cleared automatically once the form has succeeded
  // (isDirty follows the field values, which are not reset on success --
  // the component redirects away instead, see handleSubmit).
  useEffect(() => {
    if (status === "success" || !isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, status]);

  function handleCancelClick(e: React.MouseEvent) {
    if (isDirty && !window.confirm(t("dirtyConfirmMessage"))) {
      e.preventDefault();
    }
  }

  // GAP-HR-TRAINING-NEW-01: the redirect lives in its own cleanup-safe
  // effect (replacing the original's bare `setTimeout` in the submit
  // handler, whose timer kept firing — and calling `router.push` on an
  // unmounted component — if the user navigated away during the 1.5s
  // window) so unmounting the form always clears the pending timer.
  useEffect(() => {
    if (status !== "success") return;
    const redirectTimer = setTimeout(() => router.push("/hr/training"), 1500);
    return () => clearTimeout(redirectTimer);
  }, [status, router]);

  // GAP-HR-TRAINING-NEW-03: non-blocking -- a past fromDate can be a
  // legitimate back-dated capture of a training already held, so this is a
  // warning, never a submit-blocking error.
  const pastDateWarning = values.fromDate && values.fromDate < todayInIst() ? t("pastDateWarning") : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setCrossFieldError({});

    const fieldsValid = validate();
    const nextCrossFieldError: { toDate?: string; enrollmentDeadline?: string } = {};
    if (fieldsValid && values.toDate < values.fromDate) {
      nextCrossFieldError.toDate = t("errToDateBeforeFromDate");
    }
    if (enrollmentDeadline && enrollmentDeadline > values.fromDate) {
      nextCrossFieldError.enrollmentDeadline = t("errDeadlineAfterStart");
    }
    setCrossFieldError(nextCrossFieldError);

    if (!fieldsValid || Object.keys(nextCrossFieldError).length > 0) {
      setStatus("error");
      setMessage(t("statusFixFields"));
      return;
    }

    setStatus("submitting");

    try {
      const res = await fetch("/api/proxy/v1/hrms/trainings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.title.trim(),
          venue: values.venue.trim() || undefined,
          fromDate: values.fromDate,
          toDate: values.toDate,
          facilitator: values.facilitator.trim() || undefined,
          maxParticipants: parseInt(values.maxParticipants, 10),
          category: category || undefined,
          mode: mode || undefined,
          enrollmentDeadline: enrollmentDeadline || undefined,
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(resolved.message);
        return;
      }

      // GAP-HR-TRAINING-NEW-01: POST only queues a command (202 accepted);
      // the row lands moments later via the async consumer. Saying
      // "created successfully" here was simply false, and the redirect
      // could easily beat both the consumer AND (before this same PR's
      // consumer.ts / loaders.ts changes) a stale cache back to the list.
      // Say what actually happened, keep the button disabled so a slow
      // consumer can't be mistaken for "it didn't work" and resubmitted,
      // and let the list's own now-immediate cache invalidation (see
      // consumer.ts) plus router.refresh() below do the rest.
      setStatus("success");
      setMessage(t("submittedMessage"));
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  const busy = status === "submitting";
  const doneOrBusy = busy || status === "success";

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      noValidate
      aria-label={t("formAriaLabel")}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl"
    >
      <Field label={t("titleLabel")} required error={fields.title.error}>
        <Input
          value={fields.title.value}
          onChange={fields.title.onChange}
          onBlur={fields.title.onBlur}
          placeholder={t("titlePlaceholder")}
          maxLength={256}
          disabled={doneOrBusy}
        />
      </Field>

      <Field label={t("venueLabel")} error={fields.venue.error}>
        <Input
          value={fields.venue.value}
          onChange={fields.venue.onChange}
          onBlur={fields.venue.onBlur}
          placeholder={t("venuePlaceholder")}
          maxLength={256}
          disabled={doneOrBusy}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t("fromDateLabel")} required error={fields.fromDate.error}>
          <Input
            type="date"
            value={fields.fromDate.value}
            onChange={fields.fromDate.onChange}
            onBlur={fields.fromDate.onBlur}
            disabled={doneOrBusy}
          />
        </Field>
        <Field label={t("toDateLabel")} required error={fields.toDate.error || crossFieldError.toDate}>
          <Input
            type="date"
            value={fields.toDate.value}
            onChange={fields.toDate.onChange}
            onBlur={fields.toDate.onBlur}
            disabled={doneOrBusy}
          />
        </Field>
      </div>
      {pastDateWarning && (
        <p role="status" className="text-xs text-amber-700">⚠️ {pastDateWarning}</p>
      )}

      <Field label={t("facilitatorLabel")} error={fields.facilitator.error}>
        <Input
          value={fields.facilitator.value}
          onChange={fields.facilitator.onChange}
          onBlur={fields.facilitator.onBlur}
          placeholder={t("facilitatorPlaceholder")}
          maxLength={256}
          disabled={doneOrBusy}
        />
      </Field>

      <Field label={t("maxParticipantsLabel")} required error={fields.maxParticipants.error}>
        <Input
          type="number"
          min={1}
          step={1}
          value={fields.maxParticipants.value}
          onChange={fields.maxParticipants.onChange}
          onBlur={fields.maxParticipants.onBlur}
          disabled={doneOrBusy}
        />
      </Field>

      {/* GAP-HR-TRAINING-NEW-02: category/mode/enrolment-deadline -- all
          optional; an unset category/mode renders no badge downstream
          (GAP-HR-TRAINING-02/03), never a guess. */}
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("categoryLabel")}>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryValue)}
            disabled={doneOrBusy}
          >
            <option value="">{t("categoryNone")}</option>
            <option value="mandatory">{tTraining("category.mandatory")}</option>
            <option value="optional">{tTraining("category.optional")}</option>
            <option value="leadership">{tTraining("category.leadership")}</option>
          </Select>
        </Field>
        <Field label={t("modeLabel")}>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeValue)}
            disabled={doneOrBusy}
          >
            <option value="">{t("modeNone")}</option>
            <option value="online">{tTraining("mode.online")}</option>
            <option value="classroom">{tTraining("mode.classroom")}</option>
            <option value="blended">{tTraining("mode.blended")}</option>
          </Select>
        </Field>
      </div>

      <Field label={t("enrollmentDeadlineLabel")} error={crossFieldError.enrollmentDeadline}>
        <Input
          type="date"
          value={enrollmentDeadline}
          onChange={(e) => setEnrollmentDeadline(e.target.value)}
          disabled={doneOrBusy}
        />
      </Field>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button type="submit" loading={busy} disabled={doneOrBusy}>
          {busy ? t("submittingBtn") : t("submitBtn")}
        </Button>
        {/* GAP-HR-TRAINING-NEW-05: no Cancel affordance existed beyond the
            PageHeader's own generic back link; this one also carries the
            unsaved-changes confirm. */}
        <Link href="/hr/training" className="btn ghost" onClick={handleCancelClick}>
          {t("cancelBtn")}
        </Link>
      </div>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}

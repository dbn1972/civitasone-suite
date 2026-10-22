"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useFormError } from "@/lib/useFormError";
import { useZodFieldValidation } from "@/lib/form-validation";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import { useInAppNavigationGuard } from "@/lib/useInAppNavigationGuard";
import { listContainsId } from "@/lib/listContainsId";
import { todayIST } from "@/lib/formatters";
import { AcceptedNotice, Alert, Button, ConfirmDialog, Field, Input, Select } from "../../../../_components/ds";

const TRAINING_LIST_HREF = "/hr/training";
// limit=500 (the route's own maximum): the confirmation poll must be able to
// see the new programme even in a tenant with more than the default 50 rows.
const PROGRAMS_URL = "/api/proxy/v1/hrms/training-programs?limit=500";

type CategoryValue = "" | "mandatory" | "optional" | "leadership";
type ModeValue = "" | "online" | "classroom" | "blended";

/** The id the 202 handed back; null if the body was unreadable (then nothing can be confirmed). */
type CreatedProgram = { id: string | null };

export function NewTrainingForm() {
  const t = useTranslations("trainingNew");
  const tTraining = useTranslations("training");
  const router = useRouter();
  const formError = useFormError("training program");

  /**
   * GAP-HR-TRAINING-NEW-03/04: schema mirrors the server's createTrainingBody
   * (services/hrms-service/src/modules/training/validators.ts) for the
   * per-field checks, with every message coming from the trainingNew i18n
   * namespace (the earlier version printed bare zod tokens such as
   * "invalidInt" straight into the Field). useZodFieldValidation validates
   * each field independently as a string -- cross-field rules (toDate >=
   * fromDate, deadline <= fromDate) are not expressible per field that way,
   * so handleSubmit checks them separately.
   */
  const schema = useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1, t("errRequired")).max(256, t("errTooLong", { max: 256 })),
        venue: z.string().trim().max(256, t("errTooLong", { max: 256 })),
        fromDate: z.string().trim().min(1, t("errRequired")).regex(/^\d{4}-\d{2}-\d{2}$/, t("errInvalidDate")),
        toDate: z.string().trim().min(1, t("errRequired")).regex(/^\d{4}-\d{2}-\d{2}$/, t("errInvalidDate")),
        facilitator: z.string().trim().max(256, t("errTooLong", { max: 256 })),
        // Kept a string (see useZodFieldValidation) and refined to a clean
        // positive-integer pattern: Number("") would coerce to 0 and "2.5"
        // would pass a bare Number() check. This is the guard for any path
        // that bypasses the browser's native step/min validation.
        maxParticipants: z
          .string()
          .trim()
          .min(1, t("errRequired"))
          .refine((v) => /^[1-9]\d*$/.test(v), t("errWholeNumber")),
      }),
    [t],
  );
  const { fields, validate, values } = useZodFieldValidation(schema);

  const [category, setCategory] = useState<CategoryValue>("");
  const [mode, setMode] = useState<ModeValue>("");
  const [enrollmentDeadline, setEnrollmentDeadline] = useState("");
  const [crossFieldError, setCrossFieldError] = useState<{ toDate?: string; enrollmentDeadline?: string }>({});
  // Local lifecycle for the POST itself; what happens after the 202 is owned
  // by `accepted` (the shared SF-15 accepted -> poll -> confirmed machine).
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  /**
   * GAP-HR-TRAINING-NEW-01: POST /v1/hrms/trainings only queues a command
   * (202 accepted); a consumer inserts the row moments later. So the form
   * (a) says "Submitted", never "created", (b) polls the programmes list (the
   * resource's own GET -- there is no command-status endpoint) until the new
   * id shows up, then refreshes the Router Cache and moves to the list, and
   * (c) if the id has not appeared when the bounded poll runs out, says so
   * honestly and links to the list with `?created=<id>` so the list can keep
   * showing a "still processing" notice. No fixed-delay redirect, and the
   * poll is cancelled on unmount by the hook.
   */
  const accepted = useAcceptedWrite<CreatedProgram, unknown>({
    poll: async () => {
      const res = await fetch(PROGRAMS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("programmes list not readable yet");
      return res.json() as Promise<unknown>;
    },
    isDone: (polled, created) => created.id !== null && listContainsId(polled, created.id),
    // useAcceptedWrite has already called router.refresh() (dropping the
    // Router Cache entry for the list) by the time this runs.
    onConfirmed: () => router.push(TRAINING_LIST_HREF),
    maxAttempts: 5,
    initialDelayMs: 500,
  });

  const submitted = accepted.phase !== "idle";
  const busy = status === "submitting";
  // Fields and the submit button stay locked from the first click until the
  // user leaves, so an uncertain 202 can never be resubmitted into a duplicate.
  const locked = busy || submitted;

  const isDirty = useMemo(
    () =>
      Object.values(values).some((v) => v.trim() !== "") ||
      category !== "" || mode !== "" || enrollmentDeadline !== "",
    [values, category, mode, enrollmentDeadline],
  );
  // Once the programme has been accepted there is nothing left to lose, so
  // neither the unload prompt nor the discard dialog applies any more.
  const guardActive = isDirty && !submitted;

  // GAP-HR-TRAINING-NEW-05: beforeunload covers tab close / reload; the
  // click interceptor covers every in-app link (Cancel, the PageHeader back
  // link, the sidebar) that a client-side route change would otherwise slip
  // past. SF-19: the prompt is the shared ConfirmDialog, not window.confirm.
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  useUnsavedChangesGuard(guardActive);
  useInAppNavigationGuard(guardActive, setDiscardTarget);

  // GAP-HR-TRAINING-NEW-03: non-blocking -- a past fromDate can be a
  // legitimate back-dated capture of a training already held, so this is a
  // warning, never a submit-blocking error.
  const pastDateWarning = values.fromDate && values.fromDate < todayIST() ? t("pastDateWarning") : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
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

      const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
      const id = typeof body?.id === "string" && body.id ? body.id : null;
      setCreatedId(id);
      setStatus("idle");
      // Busts the client Router Cache straight away; the poll then waits for
      // the consumer and onConfirmed moves on to the list.
      router.refresh();
      void accepted.accept({ id });
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  const listHref = createdId
    ? `${TRAINING_LIST_HREF}?created=${encodeURIComponent(createdId)}`
    : TRAINING_LIST_HREF;

  return (
    <>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        noValidate
        aria-label={t("formAriaLabel")}
        className="card"
        style={{ maxWidth: 672 }}
      >
        <div className="pad" style={{ display: "grid", gap: 16 }}>
          <Field label={t("titleLabel")} required error={fields.title.error}>
            <Input
              value={fields.title.value}
              onChange={fields.title.onChange}
              onBlur={fields.title.onBlur}
              placeholder={t("titlePlaceholder")}
              maxLength={256}
              disabled={locked}
            />
          </Field>

          <Field label={t("venueLabel")} error={fields.venue.error}>
            <Input
              value={fields.venue.value}
              onChange={fields.venue.onChange}
              onBlur={fields.venue.onBlur}
              placeholder={t("venuePlaceholder")}
              maxLength={256}
              disabled={locked}
            />
          </Field>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <Field label={t("fromDateLabel")} required error={fields.fromDate.error}>
              <Input
                type="date"
                value={fields.fromDate.value}
                onChange={fields.fromDate.onChange}
                onBlur={fields.fromDate.onBlur}
                disabled={locked}
              />
            </Field>
            <Field label={t("toDateLabel")} required error={fields.toDate.error || crossFieldError.toDate}>
              <Input
                type="date"
                value={fields.toDate.value}
                onChange={fields.toDate.onChange}
                onBlur={fields.toDate.onBlur}
                disabled={locked}
              />
            </Field>
          </div>
          {pastDateWarning && (
            <Alert variant="warning" style={{ marginBottom: 0 }}>
              {pastDateWarning}
            </Alert>
          )}

          <Field label={t("facilitatorLabel")} error={fields.facilitator.error}>
            <Input
              value={fields.facilitator.value}
              onChange={fields.facilitator.onChange}
              onBlur={fields.facilitator.onBlur}
              placeholder={t("facilitatorPlaceholder")}
              maxLength={256}
              disabled={locked}
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
              disabled={locked}
            />
          </Field>

          {/* GAP-HR-TRAINING-NEW-02: category/mode/enrolment-deadline -- all
              optional; an unset category/mode renders no badge downstream
              (GAP-HR-TRAINING-02/03), never a guess. */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <Field label={t("categoryLabel")}>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as CategoryValue)}
                disabled={locked}
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
                disabled={locked}
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
              disabled={locked}
            />
          </Field>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Button type="submit" loading={busy} disabled={locked}>
              {busy ? t("submittingBtn") : t("submitBtn")}
            </Button>
            {/* GAP-HR-TRAINING-NEW-05: the Cancel link is an ordinary link --
                useInAppNavigationGuard turns it (and the PageHeader back
                link) into the discard confirm while the form is dirty. */}
            <Link href={TRAINING_LIST_HREF} className="btn ghost">
              {t("cancelBtn")}
            </Link>
          </div>

          {status === "error" && message && (
            <p role="alert" aria-live="assertive" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>
              {message}
            </p>
          )}

          {submitted && (
            <div role="status">
              {/* No onDismiss / onRefresh: dismissing would unlock the form and
                  invite exactly the duplicate create the lock above prevents;
                  the list link below is the manual way to re-check. */}
              <AcceptedNotice
                phase={accepted.phase}
                error={accepted.error}
                message={t("submittedMessage")}
                labels={{ timedOut: t("stillProcessingMessage") }}
              />
              {accepted.phase === "timed_out" && (
                <Link href={listHref} className="btn ghost">
                  {t("viewListLink")}
                </Link>
              )}
            </div>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={discardTarget !== null}
        danger
        title={t("discardTitle")}
        description={t("dirtyConfirmMessage")}
        confirmLabel={t("discardConfirm")}
        cancelLabel={t("keepEditing")}
        onConfirm={() => {
          const destination = discardTarget ?? TRAINING_LIST_HREF;
          setDiscardTarget(null);
          router.push(destination);
        }}
        onCancel={() => setDiscardTarget(null)}
      />
    </>
  );
}

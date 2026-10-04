"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useEffect, useId, useState, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApplicationPipeline } from "../_components/ApplicationPipeline";
import { GOIReservationCard, ROSTER_CATEGORIES, categoryOfApplication, type RosterCategory } from "../_components/GOIReservationCard";
import { InterviewCard } from "../_components/InterviewCard";
import { VacancyNotificationPanel } from "../_components/VacancyNotificationPanel";
import { ContactReveal } from "../_components/ContactReveal";
import { OfferWorkflowDialog } from "./_components/OfferWorkflowDialog";
import { ApplicationFeeDialog } from "./_components/ApplicationFeeDialog";
import { ConfirmDialog, ErrorState, useConfirmAction, Button, EntityPicker, StatusPill } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { formatIndianDate, formatIndianDateTime, todayIST } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { REJECTION_REASON_CODES, isVacancyType, type RejectionReasonCode } from "@/lib/recruitment";

/** Shared Tailwind classes for the two new custom dialogs below (Schedule
 *  Interview / Send Offer), matching this page's own input styling
 *  conventions (e.g. the applicant search box further down). */
const dialogInputClass = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const dialogLabelClass = "block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1";

type JobOpening = {
  id: string;
  refNo: string;
  jobTitle: string;
  department?: string;
  vacancies: number;
  status: string;
  isPublished?: boolean | string;
  vacancyType?: string;
  applicationDeadline?: string;
  postedDate?: string;
  applicationsReceived?: number;
};

type Application = {
  id: string;
  /** Human-readable reference; also the only identifier shown in blind-screening mode. */
  applicationNo?: string | null;
  applicantName: string;
  /** True when the service sent email/mobile already masked (the default). */
  contactMasked?: boolean;
  /** An uploaded resume exists (GAP-RECRUITMENT-CAREERS-DETAIL-04); opened through an audited link. */
  hasResume?: boolean;
  email?: string;
  mobile?: string;
  qualification?: string;
  experienceYears?: number;
  skills?: string[];
  source?: string;
  stage: string;
  screeningDecision: string;
  appliedAt?: string;
  /** GOI reservation category (SC/ST/OBC/PH/EWS/…), case as recorded on the
   * application. Optional: not every intake path collects it yet -- see
   * reservationFill below, which treats "no application has this set" as
   * an honest no-data state rather than a fabricated 0%. */
  category?: string;
};

type DecisionState = Record<string, "idle" | "submitting" | "done" | "error">;

/** How long to wait before re-reading after a queued (202) write, and how often to poll a publish toggle. */
const QUEUED_RELOAD_MS = 1200;
const PUBLISH_POLL_MS = 1500;
const PUBLISH_POLL_ATTEMPTS = 5;
const BULK_SHORTLIST_CHUNK = 500;

type InterviewSlot = {
  id: string;
  applicationId: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
};

/** The stored date + time are UTC (interview-routes.ts derives them from an ISO instant). */
function interviewInstant(i: InterviewSlot): string {
  return `${i.scheduledDate}T${i.scheduledTime}:00.000Z`;
}

/** Valid next actions per application stage */
type ConfirmConfig = {
  title: string;
  description: string;
  confirmLabel?: string;
  requireReason?: boolean;
  /** Collect a structured REJECTION_REASON_CODES value (required) plus optional remarks. */
  rejectReasonCode?: boolean;
};

type RejectPayload = { reasonCode: RejectionReasonCode; remarks?: string };

type ActionDef = {
  label: string;
  key: string;
  variant: "primary" | "danger" | "ghost";
  disabled?: boolean;
  disabledReason?: string;
  /** Present for actions that must be gated behind a ConfirmDialog (L4 — irreversible action). */
  confirm?: ConfirmConfig;
  /** Present for actions that need a real multi-field form (a single reason
   *  string, which is all ConfirmDialog collects, isn't enough) — opens one
   *  of the custom dialogs below instead of calling onAction directly. */
  dialog?: "interview" | "offer" | "fee";
};

const INTERVIEW_MODES = ["video", "in_person", "phone"] as const;
const INTERVIEW_ROUND_TYPES = [
  "technical", "screening", "hr", "panel", "final",
  "group_discussion", "domain", "behavioural", "presentation", "final_selection",
] as const;

export type ScheduleInterviewPayload = {
  interviewerIds: string[];
  scheduledAt: string;
  durationMinutes: number;
  mode: typeof INTERVIEW_MODES[number];
  roundType: typeof INTERVIEW_ROUND_TYPES[number];
  roundNumber: number;
  notes?: string;
};

/**
 * CRITICAL fix (Bug 2): real form for the previously-disabled "Schedule
 * Interview" action, calling the already-fully-built POST /v1/hrms/interviews
 * (interview-routes.ts) via the parent's onAction dispatcher. On success it
 * renders the already-built-but-previously-imported-nowhere InterviewCard
 * with the interview just scheduled, so this component finally gets a real
 * caller instead of sitting unused.
 */
function ScheduleInterviewDialog({
  applicantName,
  jobTitle,
  onSubmit,
  onClose,
}: {
  applicantName: string;
  jobTitle: string;
  onSubmit: (payload: ScheduleInterviewPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("recruitmentDetail");
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [interviewerNames, setInterviewerNames] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [mode, setMode] = useState<typeof INTERVIEW_MODES[number]>("video");
  const [roundType, setRoundType] = useState<typeof INTERVIEW_ROUND_TYPES[number]>("technical");
  const [roundNumber, setRoundNumber] = useState(1);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const fieldId = useId();

  const submittedPayload = useRef<ScheduleInterviewPayload | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (interviewerIds.length === 0 || !scheduledAt) { // ux-001-ok: client-side validation of locally-typed form input, no loader/fetch involved
      setStatus("error");
      setMessage(t("scheduleInterviewFieldsRequired"));
      return;
    }
    const payload: ScheduleInterviewPayload = {
      interviewerIds,
      scheduledAt: new Date(scheduledAt).toISOString(),
      durationMinutes,
      mode,
      roundType,
      roundNumber,
      notes: notes.trim() || undefined,
    };
    setStatus("submitting");
    setMessage("");
    try {
      await onSubmit(payload);
      submittedPayload.current = payload;
      // Show names, never UUIDs, on the confirmation card (GAP-RECRUITMENT-DETAIL-06).
      let names = "";
      try { names = (await resolveEmployees(payload.interviewerIds)).map((o) => o.label).join(", "); } catch { names = ""; }
      setInterviewerNames(names || t("interviewersSelected", { count: payload.interviewerIds.length }));
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}
    >
      <div className="w-full max-w-md mx-4 rounded-xl bg-white dark:bg-gray-900 p-6 shadow-2xl">
        <h2 id={`${fieldId}-title`} className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">
          {t("scheduleInterviewDialogTitle", { name: applicantName })}
        </h2>

        {status === "success" && submittedPayload.current ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("interviewScheduledMessage")}</p>
            <InterviewCard
              candidateName={applicantName}
              roleApplied={jobTitle}
              slotISO={submittedPayload.current.scheduledAt}
              interviewerName={interviewerNames}
            />
            <Button onClick={onClose} style={{ alignSelf: "flex-end" }}>{t("dialogDone")}</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor={`${fieldId}-interviewers`} className={dialogLabelClass}>{t("interviewerIds")}</label>
              <EntityPicker
                id={`${fieldId}-interviewers`}
                multiple
                value={interviewerIds}
                onChange={(v) => setInterviewerIds(Array.isArray(v) ? v : v ? [v] : [])}
                search={searchEmployees}
                resolve={resolveEmployees}
                placeholder={t("interviewerIdsPlaceholder")}
                noResultsText={t("interviewersNoMatch")}
                searchingText={t("interviewersSearching")}
                removeOptionAriaLabel={(label) => t("interviewersRemove", { label })}
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{t("interviewerIdsHelp")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${fieldId}-when`} className={dialogLabelClass}>{t("scheduledAt")}</label>
                <input
                  id={`${fieldId}-when`} type="datetime-local" className={dialogInputClass}
                  value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-duration`} className={dialogLabelClass}>{t("durationMinutes")}</label>
                <input
                  id={`${fieldId}-duration`} type="number" min={15} max={480} className={dialogInputClass}
                  value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor={`${fieldId}-mode`} className={dialogLabelClass}>{t("interviewMode")}</label>
                <select id={`${fieldId}-mode`} className={dialogInputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  {INTERVIEW_MODES.map((m) => <option key={m} value={m}>{t(`interviewMode_${m}`)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${fieldId}-round-type`} className={dialogLabelClass}>{t("roundType")}</label>
                <select id={`${fieldId}-round-type`} className={dialogInputClass} value={roundType} onChange={(e) => setRoundType(e.target.value as typeof roundType)}>
                  {INTERVIEW_ROUND_TYPES.map((r) => <option key={r} value={r}>{t(`roundType_${r}`)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${fieldId}-round-number`} className={dialogLabelClass}>{t("roundNumber")}</label>
                <input
                  id={`${fieldId}-round-number`} type="number" min={1} className={dialogInputClass}
                  value={roundNumber} onChange={(e) => setRoundNumber(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${fieldId}-notes`} className={dialogLabelClass}>{t("notesOptional")}</label>
              <textarea id={`${fieldId}-notes`} rows={2} className={dialogInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {status === "error" && message && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">{message}</p>
            )}

            <div className="flex justify-end gap-2 mt-1">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                {t("dialogCancel")}
              </button>
              <button type="submit" disabled={status === "submitting"} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                {status === "submitting" ? t("scheduling") : t("actionScheduleInterview")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ContextMenu({
  app,
  jobTitle,
  onAction,
  onOfferChanged,
  actionState,
}: {
  app: Application;
  jobTitle: string;
  onAction: (appId: string, key: string, payload?: unknown) => Promise<void>;
  /** An offer moved through the approval workflow: re-read the inbox (a release moves the stage to "offered"). */
  onOfferChanged: () => void;
  actionState: "idle" | "submitting" | "done" | "error";
}) {
  const t = useTranslations("recruitmentDetail");
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
  const [activeDialog, setActiveDialog] = useState<"interview" | "offer" | "fee" | null>(null);
  const [rejectCode, setRejectCode] = useState<RejectionReasonCode | "">("");
  const rejectCodeSelectId = useId();
  const ref = useRef<HTMLDivElement>(null);

  const REJECT_CONFIRM: ConfirmConfig = {
    title: t("rejectConfirmTitle"),
    description: t("rejectConfirmDescription"),
    confirmLabel: t("rejectConfirmLabel"),
    rejectReasonCode: true,
  };

  const WITHDRAW_CONFIRM: ConfirmConfig = {
    title: t("withdrawConfirmTitle"),
    description: t("withdrawConfirmDescription"),
    confirmLabel: t("withdrawConfirmLabel"),
    requireReason: true,
  };

  // COMP-004 detector note: static reference -- this is the fixed action-menu
  // (which buttons appear) per recruitment-pipeline stage, a UX/state-machine
  // decision, not data. The applications it acts on are real-loaded above.
  const STAGE_ACTIONS: Record<string, ActionDef[]> = {
    applied: [
      { label: t("actionShortlist"), key: "shortlist", variant: "primary" },
      { label: t("actionFee"),       key: "fee",       variant: "ghost",   dialog: "fee" },
      { label: t("actionReject"),    key: "reject",    variant: "danger", confirm: REJECT_CONFIRM },
    ],
    shortlisted: [
      // CRITICAL fix (Bug 2): these two were the dead end -- Schedule
      // Interview was permanently disabled and nothing else in this bucket
      // could move an application off "shortlisted", so the Hire dialog on
      // the application detail page (canHire = stage selected|offered) could
      // never become reachable through the UI. Both now open a real dialog
      // (below) backed by already-built, already-hardened endpoints.
      { label: t("actionScheduleInterview"), key: "schedule_interview", variant: "primary", dialog: "interview" },
      { label: t("actionSendOffer"),         key: "send_offer",         variant: "primary", dialog: "offer" },
      { label: t("actionFee"),               key: "fee",                variant: "ghost",   dialog: "fee" },
      { label: t("actionReject"),            key: "reject",             variant: "danger", confirm: REJECT_CONFIRM },
    ],
    selected: [
      { label: t("actionManageOffer"), key: "manage_offer", variant: "primary", dialog: "offer" },
      { label: t("actionMarkJoined"), key: "mark_joined", variant: "primary", disabled: true, disabledReason: t("actionMarkJoinedDisabledReason") },
      { label: t("actionWithdraw"),   key: "withdraw",    variant: "danger", confirm: WITHDRAW_CONFIRM },
    ],
    offered: [
      { label: t("actionManageOffer"), key: "manage_offer", variant: "primary", dialog: "offer" },
      { label: t("actionMarkJoined"), key: "mark_joined", variant: "primary", disabled: true, disabledReason: t("actionMarkJoinedDisabledReason") },
      { label: t("actionWithdraw"),   key: "withdraw",    variant: "danger", confirm: WITHDRAW_CONFIRM },
    ],
    hired:     [],
    rejected:  [],
    withdrawn: [],
  };

  const actions = STAGE_ACTIONS[app.stage] ?? [];

  const {
    open: confirmOpen,
    busy: confirmBusy,
    error: confirmError,
    trigger: triggerConfirm,
    cancel: cancelConfirm,
    confirm: confirmAction,
  } = useConfirmAction({
    onConfirm: async (reason) => {
      if (!pendingAction) return;
      if (pendingAction.confirm?.rejectReasonCode) {
        if (!rejectCode) return;
        const payload: RejectPayload = { reasonCode: rejectCode, ...(reason ? { remarks: reason } : {}) };
        await onAction(app.id, pendingAction.key, payload);
        return;
      }
      await onAction(app.id, pendingAction.key, reason);
    },
    onSuccess: () => { setPendingAction(null); setRejectCode(""); },
  });

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (actions.length === 0) { // ux-001-ok: static STAGE_ACTIONS lookup keyed by app.stage (see the COMP-004 note above) -- not a loader result
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500 italic">{t("noActions")}</span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={actionState === "submitting"}
        aria-label={t("applicationActionsAriaLabel")}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
      >
        {actionState === "submitting" ? "…" : t("actionsButton")}
        <span aria-hidden="true" className="text-slate-400 dark:text-slate-500">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full mt-1 z-20 min-w-[180px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 shadow-lg py-1"
        >
          {actions.map((act) => (
            <div key={act.key} className="relative group">
              <button
                type="button"
                role="menuitem"
                disabled={act.disabled || actionState === "submitting"}
                onClick={async () => {
                  if (act.dialog) {
                    setOpen(false);
                    setActiveDialog(act.dialog);
                    return;
                  }
                  if (act.confirm) {
                    setOpen(false);
                    setPendingAction(act);
                    triggerConfirm();
                    return;
                  }
                  try {
                    await onAction(app.id, act.key);
                    setOpen(false);
                  } catch {
                    // Leave the menu open on failure — closing it immediately (the
                    // previous behavior) made the "Action failed — try again" hint
                    // below unreachable, so a failed request looked identical to a
                    // successful one from the officer's point of view.
                  }
                }}
                className={[
                  "w-full text-start px-4 py-2 text-xs font-medium transition-colors",
                  act.disabled
                    ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                    : act.variant === "danger"
                    ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {act.label}
              </button>
              {act.disabled && act.disabledReason && (
                <span
                  role="tooltip"
                  className="hidden group-hover:block absolute start-0 top-full mt-0.5 z-30 rounded-md bg-slate-800 text-white text-[10px] px-2 py-1 whitespace-nowrap shadow-lg"
                >
                  {act.disabledReason}
                </span>
              )}
            </div>
          ))}
          {actionState === "error" && (
            <p className="px-4 py-1 text-[10px] text-red-500 dark:text-red-400">{t("actionFailed")}</p>
          )}
        </div>
      )}

      {pendingAction?.confirm && (
        <ConfirmDialog
          open={confirmOpen}
          title={pendingAction.confirm.title}
          description={pendingAction.confirm.description}
          confirmLabel={pendingAction.confirm.confirmLabel}
          danger
          requireReason={pendingAction.confirm.requireReason}
          optionalReason={pendingAction.confirm.rejectReasonCode === true}
          maxReasonLength={pendingAction.confirm.rejectReasonCode ? 2000 : undefined}
          reasonLabel={pendingAction.confirm.rejectReasonCode ? t("rejectRemarksLabel") : t("reasonLabel")}
          confirmDisabled={pendingAction.confirm.rejectReasonCode === true && rejectCode === ""}
          busy={confirmBusy}
          errorMessage={confirmError}
          onConfirm={confirmAction}
          onCancel={() => {
            cancelConfirm();
            setPendingAction(null);
            setRejectCode("");
          }}
        >
          {pendingAction.confirm.rejectReasonCode && (
            <div className="cd-field">
              <label htmlFor={rejectCodeSelectId}>{t("rejectReasonLabel")}</label>
              <select
                id={rejectCodeSelectId}
                value={rejectCode}
                onChange={(e) => setRejectCode(e.target.value as RejectionReasonCode | "")}
                aria-required="true"
                className={dialogInputClass}
              >
                <option value="">{t("rejectReasonPlaceholder")}</option>
                {REJECTION_REASON_CODES.map((c) => (
                  <option key={c} value={c}>{t(`rejectReason_${c}`)}</option>
                ))}
              </select>
            </div>
          )}
        </ConfirmDialog>
      )}

      {activeDialog === "interview" && (
        <ScheduleInterviewDialog
          applicantName={app.applicantName}
          jobTitle={jobTitle}
          onSubmit={(payload) => onAction(app.id, "schedule_interview", payload)}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "offer" && (
        <OfferWorkflowDialog
          applicationId={app.id}
          applicantName={app.applicantName}
          onChanged={onOfferChanged}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "fee" && (
        <ApplicationFeeDialog
          applicationId={app.id}
          applicantName={app.applicantName}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </div>
  );
}

export default function JobOpeningDetailPage() {
  const t = useTranslations("recruitmentDetail");
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [opening, setOpening] = useState<JobOpening | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingOpening, setLoadingOpening] = useState(true);
  const [loadingApps, setLoadingApps] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appsLoadError, setAppsLoadError] = useState(false);

  // MEDIUM finding: GOIReservationCard used to render with no `fill` prop
  // passed at all, so it always showed a hardcoded 0% -- a fabricated
  // figure, not a real one. Real source of truth: each application's own
  // `category` field (SC/ST/OBC/PH-style GOI reservation category) plus its
  // `stage` -- a post reserved for a category counts as "filled" once an
  // application in that category has actually been hired. `posts` per
  // category is derived from GOI_RESERVATION_QUOTA_PCT, the SAME constant
  // the card itself uses, so the two can never drift apart. When there are
  // applications but none of them carry a category yet, that's a genuine
  // data gap (not every intake path collects it) -- surfaced honestly via
  // categoryDataAvailable=false instead of a misleading 0%.
  //
  // UX-001 fix: an empty `applications` array is ambiguous between
  // "genuinely no applications yet" (fine) and "the load failed"
  // (categoryDataAvailable must NOT read as true then -- a network blip
  // would otherwise render a fabricated "0% filled" across every reservation
  // category instead of an honest unavailable state). appsLoadError (set by
  // loadApplications below) disambiguates the two; state hooks were reordered
  // above so this useMemo can reference it without a temporal-dead-zone error.
  const reservation = useMemo(() => {
    const totalVacancies = opening?.vacancies ?? 0;
    const categoryDataAvailable = !appsLoadError && (applications.length === 0 || applications.some((a) => !!a.category?.trim())); // ux-001-ok: appsLoadError IS the loader's error signal (set by loadApplications on failure below) -- already gated, just not textually "source === \"error\"" for the guard's regex to see
    const hiredByCategory: Partial<Record<RosterCategory, number>> = {};
    if (categoryDataAvailable) {
      for (const key of ROSTER_CATEGORIES) {
        hiredByCategory[key] = applications.filter((a) => categoryOfApplication(a.category) === key && a.stage === "hired").length;
      }
    }
    return { hiredByCategory, categoryDataAvailable, totalVacancies };
  }, [applications, opening?.vacancies, appsLoadError]);
  const [decisionStates, setDecisionStates] = useState<DecisionState>({});
  // Screened-eligible pool for the card's reservation shortlist (never offered in blind mode).
  const shortlistPool = useMemo(
    () => applications
      .filter((a) => a.screeningDecision === "eligible" || a.screeningDecision === "shortlisted")
      .map((a) => ({ id: a.id, label: a.applicantName, category: a.category })),
    [applications],
  );
  // GAP-RECRUITMENT-DETAIL-08: blind screening loads the service's redacted list (no name, contact,
  // category or resume in the payload at all), so what is hidden here was never sent to the browser.
  const [blind, setBlind] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  // Guards the "shortlist all pending" quick action below: without it,
  // nothing stops a second click from firing a second overlapping
  // Promise.all(...) batch of the same per-application POSTs while the
  // first batch is still in flight (busy/disabled={busy} is this
  // codebase's standard double-submit guard, e.g. IntegrationDrawer.tsx,
  // EndConversationButton.tsx).
  const [bulkResult, setBulkResult] = useState<{ shortlisted: number; skipped: number; requested: number } | null>(null);
  // CRITICAL fix (Bug 1): no UI control anywhere could ever flip is_published,
  // so nothing created through the app could reach the public /careers page.
  // The publish PATCH is queued (202); `publishPending` holds the value we are waiting to see reflected.
  const [publishPending, setPublishPending] = useState<boolean | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [advertOpen, setAdvertOpen] = useState(false);
  const [interviews, setInterviews] = useState<InterviewSlot[]>([]);
  const [interviewsLoadError, setInterviewsLoadError] = useState(false);
  const mountedRef = useRef(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, []);

  const searchId = useId();
  const formError = useFormError("vacancy");

  const loadOpening = useCallback(async (signal?: AbortSignal): Promise<JobOpening | null> => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings?limit=200`, { signal });
      if (!res.ok) { setError((await formError.fromResponse(res, "load")).message); return null; }
      const data = await res.json() as unknown;
      const arr: JobOpening[] = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.data as JobOpening[] ?? []);
      const found = arr.find((o) => o.id === id) ?? null;
      setOpening(found);
      return found;
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setError(formError.fromException("load", e).message);
      return null;
    } finally {
      setLoadingOpening(false);
    }
    // formError.fromResponse/fromException are stable across renders (see
    // useFormError) even though the wrapping object literal isn't.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [id]);

  const loadApplications = useCallback(async (signal?: AbortSignal) => {
    setAppsLoadError(false);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/${blind ? "blind-list" : "applications"}`, { signal });
      if (!res.ok) { setAppsLoadError(true); return; }
      const data = await res.json() as { data?: Application[] };
      // Blind rows carry no name: show the application reference instead (never invent a name).
      setApplications((data.data ?? []).map((a, i) => blind
        ? { ...a, applicantName: a.applicationNo ?? t("blindCandidate", { n: i + 1 }), email: undefined, mobile: undefined, category: undefined }
        : a));
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setAppsLoadError(true);
    } finally {
      setLoadingApps(false);
    }
  }, [id, blind, t]);

  // GAP-RECRUITMENT-DETAIL-02: scheduling an interview does not move the application's stage, so the
  // inbox shows the scheduled slot from the interviews list instead.
  const loadInterviews = useCallback(async (signal?: AbortSignal) => {
    setInterviewsLoadError(false);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/interviews?jobOpeningId=${id}&limit=100`, { signal });
      if (!res.ok) { setInterviewsLoadError(true); return; }
      const data = await res.json() as { data?: InterviewSlot[] };
      setInterviews(data.data ?? []);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setInterviewsLoadError(true);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadOpening(controller.signal);
    void loadApplications(controller.signal);
    void loadInterviews(controller.signal);
    return () => controller.abort();
  }, [loadOpening, loadApplications, loadInterviews]);

  // Writes here are queued (202): re-read now and once more shortly after, instead of assuming success.
  const reloadAfterQueuedWrite = useCallback(() => {
    void loadApplications();
    void loadInterviews();
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;
      void loadApplications();
      void loadInterviews();
    }, QUEUED_RELOAD_MS);
  }, [loadApplications, loadInterviews]);

  // GAP-RECRUITMENT-DETAIL-08: open the applicant's resume through the audited short-lived link.
  const openResume = useCallback(async (appId: string) => {
    setResumeError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/resume-link`);
      if (!res.ok) { setResumeError(t("resumeLinkFailed")); return; }
      const j = await res.json() as { data?: { url?: string } };
      if (!j.data?.url || !/^https:\/\//i.test(j.data.url)) { setResumeError(t("resumeLinkFailed")); return; }
      window.open(j.data.url, "_blank", "noopener,noreferrer");
    } catch {
      setResumeError(t("resumeLinkFailed"));
    }
  }, [t]);

  const toggleBlind = useCallback(() => {
    setLoadingApps(true);
    setBlind((b) => !b);
  }, []);

  // The soonest confirmed (status scheduled) slot per application, for the inbox hint.
  const nextInterviewByApp = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of interviews) {
      if (i.status !== "scheduled") continue;
      const at = interviewInstant(i);
      if (Number.isNaN(new Date(at).getTime())) continue;
      const prev = m.get(i.applicationId);
      if (!prev || at < prev) m.set(i.applicationId, at);
    }
    return m;
  }, [interviews]);

  const handleAction = useCallback(async (appId: string, actionKey: string, payload?: unknown) => {
    // withdraw's only ever payload is an optional reason string; schedule_interview
    // passes a structured object instead (see ScheduleInterviewPayload above) —
    // narrow per-branch below rather than widening every call site to the union.
    // Offers no longer go through here: the approval workflow has its own dialog.
    const reason = typeof payload === "string" ? payload : undefined;
    setDecisionStates((s) => ({ ...s, [appId]: "submitting" }));
    try {
      let res: Response;
      if (actionKey === "shortlist") {
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/screening-decision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "shortlisted" }),
        });
        if (res.ok) {
          setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, screeningDecision: "shortlisted", stage: "shortlisted" } : a));
        }
      } else if (actionKey === "reject") {
        // reasonCode is the officer's own pick from REJECTION_REASON_CODES
        // (hrms-service modules/recruitment/screening.ts); the dialog blocks
        // confirm until one is chosen, so the audit trail records the real reason.
        const rp = payload as RejectPayload;
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/screening-decision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "ineligible", reasonCode: rp.reasonCode, ...(rp.remarks ? { remarks: rp.remarks } : {}) }),
        });
        if (res.ok) {
          setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, screeningDecision: "ineligible", stage: "rejected" } : a));
        }
      } else if (actionKey === "withdraw") {
        // Real endpoint is POST .../withdraw with a required {reason}; there is
        // no .../stage route (confirmed 404 against the live gateway).
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/withdraw`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason && reason.trim().length > 0 ? reason.trim() : t("withdrawnByHrDefaultReason") }),
        });
        if (res.ok) {
          setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, stage: "withdrawn" } : a));
        }
      } else if (actionKey === "schedule_interview") {
        // CRITICAL fix (Bug 2): real caller for interview-routes.ts's
        // already-fully-built, already-hardened POST /v1/hrms/interviews
        // (double-booking pre-check, dept-scope, atomic re-check consumer
        // side). Scheduling an interview is its own real, valuable action —
        // the backend does not gate "Send Offer" on it (application.stage
        // has no "interviewing" writer anywhere in this codebase; confirmed
        // by grep), so it does not change this application's stage/status.
        const p = payload as ScheduleInterviewPayload;
        res = await fetch(`/api/proxy/v1/hrms/interviews`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobOpeningId: id, applicationId: appId, ...p }),
        });
        if (res.ok) reloadAfterQueuedWrite();
      } else {
        // Unimplemented action — no-op
        setDecisionStates((s) => ({ ...s, [appId]: "idle" }));
        return;
      }
      if (!res.ok) {
        setDecisionStates((s) => ({ ...s, [appId]: "error" }));
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      setDecisionStates((s) => ({ ...s, [appId]: "done" }));
    } catch (e) {
      setDecisionStates((s) => ({ ...s, [appId]: "error" }));
      throw e instanceof UserFacingError ? e : UserFacingError.from(formError.fromException("save", e));
    }
    // formError.fromResponse/fromException are stable across renders (see
    // useFormError) even though the wrapping object literal isn't — safe to
    // omit `formError` itself. `t` is a real dependency, though: the
    // withdraw-reason fallback below calls t("withdrawnByHrDefaultReason"),
    // and this callback previously had an empty array, so it would have
    // frozen at whatever locale was active on mount forever (same
    // stale-closure class already fixed in CreateLeavePolicyForm.tsx, worse
    // here since it never self-heals via a dep change).
    // formError.fromResponse/fromException are stable across renders (see
    // useFormError) even though the wrapping object literal isn't — safe to
    // omit `formError` itself. `t` is a real dependency, though: the
    // withdraw-reason fallback below calls t("withdrawnByHrDefaultReason"),
    // and this callback previously had an empty array, so it would have
    // frozen at whatever locale was active on mount forever (same
    // stale-closure class already fixed in CreateLeavePolicyForm.tsx, worse
    // here since it never self-heals via a dep change). That fallback branch
    // is unreachable through the current UI (the withdraw ConfirmDialog
    // enforces requireReason and trims before calling onConfirm, so `reason`
    // here can never be empty) — fixed for correctness and as a guard
    // against a future caller bypassing that dialog, not because it has an
    // observable symptom today.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [t, id, reloadAfterQueuedWrite]);

  // CRITICAL fix (Bug 1): the actual publish control. Calls the new PATCH
  // .../publish route (publication-routes.ts), which is async (202 Accepted,
  // queued through the same publishF3Write path this file's sibling
  // advertisement/extend/cancel actions already use) — optimistic update
  // here matches this page's own existing convention for that same class of
  // endpoint (see handleAction's shortlist branch above).
  const handleTogglePublish = useCallback(async () => {
    if (!opening) return;
    const target = !(opening.isPublished === true || opening.isPublished === "true");
    setPublishError(null);
    const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/publish`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublished: target }),
    }).catch(() => null);
    if (!res) throw UserFacingError.from(formError.fromException("save", new TypeError("no response")));
    if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
    // GAP-RECRUITMENT-DETAIL-10: 202 means "queued", not "done". Keep a pending state and poll until the
    // opening actually reads back with the new value; never assume success.
    setPublishPending(target);
    void (async () => {
      for (let attempt = 0; attempt < PUBLISH_POLL_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, PUBLISH_POLL_MS));
        if (!mountedRef.current) return;
        const found = await loadOpening();
        if (!mountedRef.current) return;
        if (found && (found.isPublished === true || found.isPublished === "true") === target) {
          setPublishPending(null);
          return;
        }
      }
      if (!mountedRef.current) return;
      setPublishPending(null);
      setPublishError(t("publishStillProcessing"));
    })();
    // formError.fromResponse/fromException are stable across renders (see useFormError).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [id, opening, loadOpening, t]);

  const publishAction = useConfirmAction({ onConfirm: handleTogglePublish });

  // GAP-RECRUITMENT-DETAIL-09: one confirmation, one batch call (chunked at the route's 500 cap), and a
  // visible result -- no per-row fan-out whose failures were swallowed.
  const pendingShortlist = useMemo(
    () => applications.filter((a) => a.screeningDecision === "pending" && a.stage === "applied"),
    [applications],
  );
  const nothingToShortlist = pendingShortlist.length === 0; // ux-001-ok: only disables a button, on data the inbox already error-gates
  const bulkAction = useConfirmAction({
    onConfirm: async () => {
      const ids = pendingShortlist.map((a) => a.id);
      if (ids.length === 0) return; // ux-001-ok: no-op guard on already-loaded, error-gated data; renders nothing
      const total = { shortlisted: 0, skipped: 0, requested: 0 };
      try {
        for (let i = 0; i < ids.length; i += BULK_SHORTLIST_CHUNK) {
          const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/shortlist`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ applicationIds: ids.slice(i, i + BULK_SHORTLIST_CHUNK) }),
          });
          if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
          const j = await res.json() as { shortlisted?: number; skipped?: number; requested?: number };
          total.shortlisted += j.shortlisted ?? 0;
          total.skipped += j.skipped ?? 0;
          total.requested += j.requested ?? 0;
        }
      } catch (e) {
        // Earlier chunks may already have applied; re-read so the list reflects the truth.
        reloadAfterQueuedWrite();
        throw e instanceof Error ? e : new Error(t("shortlistAllFailed"));
      }
      setBulkResult(total);
      reloadAfterQueuedWrite();
    },
  });

  const filtered = applications.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch = !q
      || a.applicantName.toLowerCase().includes(q)
      || (a.applicationNo ?? "").toLowerCase().includes(q)
      || (a.qualification ?? "").toLowerCase().includes(q)
      || (a.skills ?? []).some((s) => s.toLowerCase().includes(q));
    const matchesStage = stageFilter === "all" || a.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  if (loadingOpening) {
    return (
      <div className="page-main">
        <p className="text-center text-slate-500 dark:text-slate-400 py-12">{t("loadingVacancy")}</p>
      </div>
    );
  }

  if (error ?? !opening) {
    return (
      <div className="page-main">
        <button onClick={() => router.back()} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4 block">
          {t("backToRecruitment")}
        </button>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
          <p className="text-center text-slate-400 dark:text-slate-500">{error ?? t("vacancyNotFound")}</p>
        </div>
      </div>
    );
  }

  const published = opening.isPublished === true || opening.isPublished === "true";
  // Publishing exposes the vacancy on the public careers page, so only an open, in-date vacancy may be
  // published; unpublishing is always allowed.
  const deadlinePassed = opening.applicationDeadline ? opening.applicationDeadline.slice(0, 10) < todayIST() : false;
  const publishBlockedReason: string | null = published ? null
    : opening.status !== "open" ? t("publishBlockedNotOpen")
    : deadlinePassed ? t("publishBlockedDeadlinePassed")
    : null;

  return (
    <div className="page-main" aria-labelledby="page-heading">
      {/* ── Header ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => router.back()} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-1 block">
            {t("recruitmentBack")}
          </button>
          <h1 id="page-heading" className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {opening.jobTitle}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{opening.refNo ? `${opening.refNo} · ` : ""}{opening.department ?? "—"}</p>
          <nav aria-label={t("subpagesNav")} className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href={`/hr/recruitment/${id}/selection`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{t("linkSelectionLists")}</Link>
            <Link href={`/hr/recruitment/${id}/results`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{t("linkResults")}</Link>
          </nav>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${published ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {published ? t("published") : t("notPublished")}
            </span>
            <StatusPill status={opening.status} />
            <button
              type="button"
              onClick={() => publishAction.trigger()}
              disabled={publishPending !== null || publishBlockedReason !== null}
              title={publishBlockedReason ?? undefined}
              aria-describedby={publishBlockedReason ? "publish-blocked-reason" : undefined}
              className={[
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                published
                  ? "border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  : "bg-indigo-600 text-white hover:bg-indigo-500",
              ].join(" ")}
            >
              {publishPending === true ? t("publishing") : publishPending === false ? t("unpublishing") : published ? t("unpublish") : t("publish")}
            </button>
          </div>
          {publishBlockedReason && (
            <p id="publish-blocked-reason" className="text-xs text-slate-500 dark:text-slate-400 max-w-xs text-end">{publishBlockedReason}</p>
          )}
          {publishPending !== null && (
            <p role="status" className="text-xs text-slate-500 dark:text-slate-400 max-w-xs text-end">{publishPending ? t("publishing") : t("unpublishing")}</p>
          )}
          {publishError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 max-w-xs text-end">{publishError}</p>
          )}
        </div>
      </div>

      {/* ── Vacancy meta ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: t("metaPosts"),        value: opening.vacancies },
          { label: t("metaType"),         value: isVacancyType(opening.vacancyType) ? t(`vacancyType_${opening.vacancyType}`) : "—" },
          { label: t("metaApplications"), value: loadingApps || appsLoadError ? "—" : applications.length },
          { label: t("metaDeadline"),     value: opening.applicationDeadline ? formatIndianDate(opening.applicationDeadline) : t("deadlineOpen") },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{String(value)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* ── GOI Reservation Status (GFR 2017) ── */}
      <GOIReservationCard
        jobOpeningId={opening.id}
        totalVacancies={opening.vacancies}
        hiredByCategory={reservation.hiredByCategory}
        categoryDataAvailable={reservation.categoryDataAvailable}
        candidates={blind || appsLoadError ? undefined : shortlistPool}
      />

      {/* ── Application Pipeline tracker ── */}
      {!loadingApps && !appsLoadError && (
        <ApplicationPipeline
          applications={applications}
          activeStage={stageFilter}
          onStageClick={(s) => setStageFilter(s)}
        />
      )}

      {/* ── Applications Inbox ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {t("applicationsInbox")}
            {!loadingApps && !appsLoadError && (
              <span className="ms-2 inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                {filtered.length} / {applications.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={blind}
              onClick={toggleBlind}
              title={t("blindHelp")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${blind ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-600 dark:text-slate-300"}`}
            >
              {blind ? t("blindOn") : t("blindOff")}
            </button>
            <label htmlFor={searchId} className="sr-only">{t("searchApplicants")}</label>
            <input
              id={searchId}
              type="search"
              placeholder={t("searchApplicantsPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm w-52 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {stageFilter !== "all" && (
              <button
                type="button"
                onClick={() => setStageFilter("all")}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t("clearFilter")}
              </button>
            )}
          </div>
        </div>

        {resumeError && <p role="alert" className="px-5 py-2 text-xs text-red-600 dark:text-red-400">{resumeError}</p>}
        {loadingApps ? (
          <div className="px-5 py-10 text-center text-slate-500 dark:text-slate-400 text-sm">{t("loadingApplications")}</div>
        ) : appsLoadError ? (
          <div className="px-5 py-8">
            <ErrorState error={toHumanError("load", { area: "applications" })} onRetry={() => loadApplications()} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {applications.length === 0
                ? t("noApplicationsYet")
                : t("noApplicationsMatchFilter")}
            </p>
            {stageFilter !== "all" && (
              <button
                type="button"
                onClick={() => setStageFilter("all")}
                className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t("showAllStages")}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((app) => {
              const ds = decisionStates[app.id] ?? "idle";
              return (
                <div key={app.id} className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/hr/recruitment/${id}/applications/${app.id}`}
                        className="font-semibold text-slate-800 dark:text-slate-100 text-sm truncate hover:underline hover:text-indigo-700 dark:hover:text-indigo-400 block"
                      >
                        {app.applicantName}
                      </Link>
                      {blind ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{t("blindRowHint")}</p>
                      ) : (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {app.contactMasked === false ? (
                            <span>{app.email}{app.mobile ? ` · ${app.mobile}` : ""}</span>
                          ) : (
                            <ContactReveal applicationId={app.id} applicantName={app.applicantName} email={app.email} mobile={app.mobile} scope="inbox" />
                          )}
                        </p>
                      )}
                      {!blind && app.category?.trim() && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                          {t("categoryClaim", { category: app.category.trim().toUpperCase() })}
                        </p>
                      )}
                      {!blind && app.hasResume && (
                        <button type="button" className="text-xs text-indigo-600 dark:text-indigo-400 underline mt-1" onClick={() => void openResume(app.id)}>
                          {t("viewResume")}
                        </button>
                      )}
                      {app.qualification && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                          {app.qualification}{app.experienceYears != null ? ` · ${t("yearsExpSuffix", { count: app.experienceYears })}` : ""}
                        </p>
                      )}
                      {(app.skills ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(app.skills ?? []).slice(0, 5).map((sk) => (
                            <span key={sk} className="rounded bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 text-xs text-indigo-700 dark:text-indigo-300">{sk}</span>
                          ))}
                          {(app.skills ?? []).length > 5 && (
                            <span className="text-xs text-slate-400 dark:text-slate-500">{t("moreSkills", { count: (app.skills ?? []).length - 5 })}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <StatusPill status={app.stage} />
                        <StatusPill status={app.screeningDecision} />
                      </div>
                      {!interviewsLoadError && nextInterviewByApp.has(app.id) && !["rejected", "withdrawn", "hired"].includes(app.stage) && (
                        <p className="text-xs font-medium text-violet-700 dark:text-violet-300">
                          {t("interviewScheduledBadge", { when: formatIndianDateTime(nextInterviewByApp.get(app.id)) })}
                        </p>
                      )}
                      {app.appliedAt && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{formatIndianDate(app.appliedAt)}</p>
                      )}
                      {/* Context-aware action menu */}
                      <ContextMenu
                        app={app}
                        jobTitle={opening.jobTitle}
                        onAction={handleAction}
                        onOfferChanged={reloadAfterQueuedWrite}
                        actionState={ds}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Advertisement & corrigenda (GAP-RECRUITMENT-DETAIL-13) ── */}
      <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        <button
          type="button"
          aria-expanded={advertOpen}
          aria-controls="advert-panel"
          onClick={() => setAdvertOpen((o) => !o)}
          className="w-full px-5 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {t("advertSectionTitle")}
          <span aria-hidden="true" className="text-slate-400">{advertOpen ? "▴" : "▾"}</span>
        </button>
        {advertOpen && (
          <div id="advert-panel" className="px-5 pb-5">
            <VacancyNotificationPanel jobOpeningId={opening.id} published={published} onChanged={() => { void loadOpening(); }} />
          </div>
        )}
      </section>

      {/* ── Quick actions ── */}
      {bulkResult && (
        <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          <span>{t("shortlistAllResult", bulkResult)}</span>
          <button type="button" onClick={() => setBulkResult(null)} className="text-xs underline">{t("dismiss")}</button>
        </div>
      )}
      <ConfirmDialog
        open={bulkAction.open}
        title={t("shortlistAllConfirmTitle", { count: pendingShortlist.length })}
        description={t("shortlistAllConfirmDescription")}
        confirmLabel={t("shortlistAllConfirmLabel", { count: pendingShortlist.length })}
        busy={bulkAction.busy}
        errorMessage={bulkAction.error}
        onConfirm={bulkAction.confirm}
        onCancel={bulkAction.cancel}
      />
      <ConfirmDialog
        open={publishAction.open}
        title={published ? t("unpublishConfirmTitle") : t("publishConfirmTitle")}
        description={published ? t("unpublishConfirmDescription") : t("publishConfirmDescription")}
        confirmLabel={published ? t("unpublishConfirmLabel") : t("publishConfirmLabel")}
        danger={published}
        busy={publishAction.busy}
        errorMessage={publishAction.error}
        onConfirm={publishAction.confirm}
        onCancel={publishAction.cancel}
      />
      {applications.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={bulkAction.busy || nothingToShortlist}
            onClick={() => { setBulkResult(null); bulkAction.trigger(); }}
            className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-4 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkAction.busy ? "…" : t("shortlistAllPending", { count: pendingShortlist.length })}
          </button>
          <button
            type="button"
            onClick={() => loadApplications()}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {t("refresh")}
          </button>
        </div>
      )}
    </div>
  );
}

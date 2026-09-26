"use client";

import { useEffect, useId, useState, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApplicationPipeline } from "../_components/ApplicationPipeline";
import { GOIReservationCard, GOI_RESERVATION_QUOTA_PCT, type GoiReservationCategory } from "../_components/GOIReservationCard";
import { InterviewCard } from "../_components/InterviewCard";
import { ConfirmDialog, ErrorState, useConfirmAction, Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";

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
  applicantName: string;
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

const STAGE_COLOR: Record<string, string> = {
  applied:      "bg-slate-100 text-slate-700",
  shortlisted:  "bg-blue-100 text-blue-700",
  interviewing: "bg-purple-100 text-purple-700",
  selected:     "bg-emerald-100 text-emerald-700",
  offered:      "bg-amber-100 text-amber-700",
  hired:        "bg-green-100 text-green-700",
  rejected:     "bg-red-100 text-red-700",
  withdrawn:    "bg-slate-100 text-slate-400",
};

const DECISION_COLOR: Record<string, string> = {
  pending:       "bg-slate-100 text-slate-500",
  shortlisted:   "bg-blue-100 text-blue-700",
  eligible:      "bg-emerald-100 text-emerald-700",
  ineligible:    "bg-red-100 text-red-700",
  waitlisted:    "bg-amber-100 text-amber-700",
  manual_review: "bg-purple-100 text-purple-700",
};

/** Valid next actions per application stage */
type ConfirmConfig = {
  title: string;
  description: string;
  confirmLabel?: string;
  requireReason?: boolean;
};

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
  dialog?: "interview" | "offer";
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
  const [interviewerIds, setInterviewerIds] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [mode, setMode] = useState<typeof INTERVIEW_MODES[number]>("video");
  const [roundType, setRoundType] = useState<typeof INTERVIEW_ROUND_TYPES[number]>("technical");
  const [roundNumber, setRoundNumber] = useState(1);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const fieldId = useId();

  const parsedInterviewerIds = interviewerIds.split(",").map((s) => s.trim()).filter(Boolean);
  const submittedPayload = useRef<ScheduleInterviewPayload | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedInterviewerIds.length === 0 || !scheduledAt) { // ux-001-ok: client-side validation of locally-typed form input, no loader/fetch involved
      setStatus("error");
      setMessage(t("scheduleInterviewFieldsRequired"));
      return;
    }
    const payload: ScheduleInterviewPayload = {
      interviewerIds: parsedInterviewerIds,
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
              interviewerName={submittedPayload.current.interviewerIds.join(", ")}
            />
            <Button onClick={onClose} style={{ alignSelf: "flex-end" }}>{t("dialogDone")}</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor={`${fieldId}-interviewers`} className={dialogLabelClass}>{t("interviewerIds")}</label>
              <input
                id={`${fieldId}-interviewers`} type="text" className={dialogInputClass}
                placeholder={t("interviewerIdsPlaceholder")}
                value={interviewerIds} onChange={(e) => setInterviewerIds(e.target.value)}
                required
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

export type SendOfferPayload = { ctcMinor: number; currency: string; joiningDate?: string };

/**
 * CRITICAL fix (Bug 2): real form for "Send Offer" — the missing link that
 * previously left every shortlisted application dead-ended (no UI path ever
 * moved stage away from "shortlisted", so the Hire dialog on the application
 * detail page — already fully built — could never become reachable). Calls
 * the already-hardened PATCH /v1/hrms/applications/:id/offer (PR #1542).
 */
function SendOfferDialog({
  applicantName,
  onSubmit,
  onClose,
}: {
  applicantName: string;
  onSubmit: (payload: SendOfferPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("recruitmentDetail");
  const [ctcRupees, setCtcRupees] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const fieldId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ctcMinor = Math.round(Number(ctcRupees) * 100);
    if (!ctcRupees || !Number.isFinite(ctcMinor) || ctcMinor <= 0) {
      setStatus("error");
      setMessage(t("sendOfferFieldsRequired"));
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      await onSubmit({ ctcMinor, currency: "INR", joiningDate: joiningDate || undefined });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}>
      <div className="w-full max-w-sm mx-4 rounded-xl bg-white dark:bg-gray-900 p-6 shadow-2xl">
        <h2 id={`${fieldId}-title`} className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">
          {t("sendOfferDialogTitle", { name: applicantName })}
        </h2>

        {status === "success" ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("offerSentMessage")}</p>
            <Button onClick={onClose} style={{ alignSelf: "flex-end" }}>{t("dialogDone")}</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor={`${fieldId}-ctc`} className={dialogLabelClass}>{t("ctc")}</label>
              <input
                id={`${fieldId}-ctc`} type="number" min={1} step="0.01" className={dialogInputClass}
                placeholder={t("ctcPlaceholder")} value={ctcRupees} onChange={(e) => setCtcRupees(e.target.value)} required
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-joining`} className={dialogLabelClass}>{t("joiningDateOptional")}</label>
              <input
                id={`${fieldId}-joining`} type="date" className={dialogInputClass}
                value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)}
              />
            </div>

            {status === "error" && message && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">{message}</p>
            )}

            <div className="flex justify-end gap-2 mt-1">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                {t("dialogCancel")}
              </button>
              <button type="submit" disabled={status === "submitting"} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                {status === "submitting" ? t("sendingOffer") : t("actionSendOffer")}
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
  actionState,
}: {
  app: Application;
  jobTitle: string;
  onAction: (appId: string, key: string, payload?: unknown) => Promise<void>;
  actionState: "idle" | "submitting" | "done" | "error";
}) {
  const t = useTranslations("recruitmentDetail");
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
  const [activeDialog, setActiveDialog] = useState<"interview" | "offer" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const REJECT_CONFIRM: ConfirmConfig = {
    title: t("rejectConfirmTitle"),
    description: t("rejectConfirmDescription"),
    confirmLabel: t("rejectConfirmLabel"),
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
      { label: t("actionReject"),            key: "reject",             variant: "danger", confirm: REJECT_CONFIRM },
    ],
    interviewing: [
      { label: t("actionSendOffer"), key: "send_offer", variant: "primary", disabled: true, disabledReason: t("actionSendOfferDisabledReason") },
      { label: t("actionReject"),   key: "reject",     variant: "danger", confirm: REJECT_CONFIRM },
    ],
    selected: [
      { label: t("actionMarkJoined"), key: "mark_joined", variant: "primary", disabled: true, disabledReason: t("actionMarkJoinedDisabledReason") },
      { label: t("actionWithdraw"),   key: "withdraw",    variant: "danger", confirm: WITHDRAW_CONFIRM },
    ],
    offered: [
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
      await onAction(app.id, pendingAction.key, reason);
    },
    onSuccess: () => setPendingAction(null),
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
          reasonLabel={t("reasonLabel")}
          busy={confirmBusy}
          errorMessage={confirmError}
          onConfirm={confirmAction}
          onCancel={() => {
            cancelConfirm();
            setPendingAction(null);
          }}
        />
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
        <SendOfferDialog
          applicantName={app.applicantName}
          onSubmit={(payload) => onAction(app.id, "send_offer", payload)}
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
    const fill: Partial<Record<GoiReservationCategory, number>> = {};
    if (categoryDataAvailable) {
      for (const key of Object.keys(GOI_RESERVATION_QUOTA_PCT) as GoiReservationCategory[]) {
        const posts = Math.max(1, Math.round((GOI_RESERVATION_QUOTA_PCT[key] / 100) * totalVacancies));
        const hiredInCategory = applications.filter(
          (a) => (a.category ?? "").trim().toLowerCase() === key && a.stage === "hired"
        ).length;
        fill[key] = Math.min(100, (hiredInCategory / posts) * 100);
      }
    }
    return { fill, categoryDataAvailable };
  }, [applications, opening?.vacancies, appsLoadError]);
  const [decisionStates, setDecisionStates] = useState<DecisionState>({});
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  // Guards the "shortlist all pending" quick action below: without it,
  // nothing stops a second click from firing a second overlapping
  // Promise.all(...) batch of the same per-application POSTs while the
  // first batch is still in flight (busy/disabled={busy} is this
  // codebase's standard double-submit guard, e.g. IntegrationDrawer.tsx,
  // EndConversationButton.tsx).
  const [shortlistAllBusy, setShortlistAllBusy] = useState(false);
  // CRITICAL fix (Bug 1): no UI control anywhere could ever flip is_published,
  // so nothing created through the app could reach the public /careers page.
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const searchId = useId();
  const formError = useFormError("vacancy");

  const loadOpening = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings?limit=200`, { signal });
      if (!res.ok) { setError((await formError.fromResponse(res, "load")).message); return; }
      const data = await res.json() as unknown;
      const arr: JobOpening[] = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.data as JobOpening[] ?? []);
      const found = arr.find((o) => o.id === id) ?? null;
      setOpening(found);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setError(formError.fromException("load").message);
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
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/applications`, { signal });
      if (!res.ok) { setAppsLoadError(true); return; }
      const data = await res.json() as { data?: Application[] };
      setApplications(data.data ?? []);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setAppsLoadError(true);
    } finally {
      setLoadingApps(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadOpening(controller.signal);
    void loadApplications(controller.signal);
    return () => controller.abort();
  }, [loadOpening, loadApplications]);

  const handleAction = useCallback(async (appId: string, actionKey: string, payload?: unknown) => {
    // withdraw's only ever payload is an optional reason string; schedule_interview
    // / send_offer pass a structured object instead (see ScheduleInterviewPayload /
    // SendOfferPayload above) — narrow per-branch below rather than widening every
    // call site to the union.
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
        // reasonCode must be one of REJECTION_REASON_CODES (hrms-service
        // modules/recruitment/screening.ts) — "eligibility" is the closest
        // structured fit for an HR-initiated reject from the pipeline view.
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/screening-decision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "ineligible", reasonCode: "eligibility" }),
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
      } else if (actionKey === "send_offer") {
        // CRITICAL fix (Bug 2): real caller for the already-hardened PATCH
        // .../offer (PR #1542) — this is the actual missing link. Nothing in
        // the UI previously called this endpoint from "shortlisted", so no
        // application could ever reach "offered"/"selected" (the only stages
        // the Hire endpoint — and the already-built Hire dialog on the
        // application detail page — accept). Optimistic stage update below
        // mirrors this same function's existing shortlist/reject/withdraw
        // convention for this endpoint family, which is async (202 Accepted,
        // queued through commands.offerApplication -> consumer.ts).
        const p = payload as SendOfferPayload;
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/offer`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(p),
        });
        if (res.ok) {
          setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, stage: "offered" } : a));
        }
      } else {
        // Unimplemented action — no-op
        setDecisionStates((s) => ({ ...s, [appId]: "idle" }));
        return;
      }
      if (!res.ok) {
        setDecisionStates((s) => ({ ...s, [appId]: "error" }));
        const resolved = await formError.fromResponse(res, "save");
        throw new Error(resolved.message);
      }
      setDecisionStates((s) => ({ ...s, [appId]: "done" }));
    } catch (e) {
      setDecisionStates((s) => ({ ...s, [appId]: "error" }));
      throw e instanceof Error ? e : new Error(formError.fromException("save").message);
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
  }, [t]);

  // CRITICAL fix (Bug 1): the actual publish control. Calls the new PATCH
  // .../publish route (publication-routes.ts), which is async (202 Accepted,
  // queued through the same publishF3Write path this file's sibling
  // advertisement/extend/cancel actions already use) — optimistic update
  // here matches this page's own existing convention for that same class of
  // endpoint (see handleAction's shortlist/send_offer branches above).
  const handleTogglePublish = useCallback(async () => {
    if (!opening) return;
    const nextIsPublished = !(opening.isPublished === true || opening.isPublished === "true");
    setPublishBusy(true);
    setPublishError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/publish`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPublished: nextIsPublished }),
      });
      if (!res.ok) {
        setPublishError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpening((prev) => prev ? { ...prev, isPublished: nextIsPublished } : prev);
    } catch {
      setPublishError(formError.fromException("save").message);
    } finally {
      setPublishBusy(false);
    }
    // formError.fromResponse/fromException are stable across renders (see useFormError).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [id, opening]);

  const filtered = applications.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch = !q
      || a.applicantName.toLowerCase().includes(q)
      || (a.email ?? "").toLowerCase().includes(q)
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
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{opening.refNo} · {opening.department ?? "—"}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${published ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {published ? t("published") : t("notPublished")}
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STAGE_COLOR[opening.status] ?? "bg-slate-100 text-slate-700"}`}>
              {opening.status}
            </span>
            <button
              type="button"
              onClick={() => void handleTogglePublish()}
              disabled={publishBusy}
              className={[
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                published
                  ? "border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  : "bg-indigo-600 text-white hover:bg-indigo-500",
              ].join(" ")}
            >
              {publishBusy ? t("publishing") : published ? t("unpublish") : t("publish")}
            </button>
          </div>
          {publishError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 max-w-xs text-end">{publishError}</p>
          )}
        </div>
      </div>

      {/* ── Vacancy meta ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: t("metaPosts"),        value: opening.vacancies },
          { label: t("metaType"),         value: opening.vacancyType ?? t("vacancyTypeRegular") },
          { label: t("metaApplications"), value: loadingApps ? "—" : applications.length },
          { label: t("metaDeadline"),     value: opening.applicationDeadline ? new Date(opening.applicationDeadline).toLocaleDateString("en-IN") : t("deadlineOpen") },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{String(value)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* ── GOI Reservation Status (GFR 2017) ── */}
      <GOIReservationCard
        totalVacancies={opening.vacancies}
        fill={reservation.fill}
        categoryDataAvailable={reservation.categoryDataAvailable}
      />

      {/* ── Application Pipeline tracker ── */}
      {!loadingApps && (
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
            {!loadingApps && (
              <span className="ms-2 inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                {filtered.length} / {applications.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
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
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {app.email}{app.mobile ? ` · ${app.mobile}` : ""}
                      </p>
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
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLOR[app.stage] ?? "bg-slate-100 text-slate-700"}`}>
                          {app.stage}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_COLOR[app.screeningDecision] ?? "bg-slate-100 text-slate-500"}`}>
                          {app.screeningDecision}
                        </span>
                      </div>
                      {app.appliedAt && (
                        <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(app.appliedAt).toLocaleDateString("en-IN")}</p>
                      )}
                      {/* Context-aware action menu */}
                      <ContextMenu
                        app={app}
                        jobTitle={opening.jobTitle}
                        onAction={handleAction}
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

      {/* ── Quick actions ── */}
      {applications.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={shortlistAllBusy}
            onClick={() => {
              // Without this guard, a second click while the first batch is
              // still in flight fires an overlapping Promise.all(...) of the
              // same per-application POSTs (double-submit) -- disabled below
              // prevents the click, and this re-checks defensively in case
              // the handler ever fires programmatically.
              if (shortlistAllBusy) return;
              const pending = applications.filter((a) => a.screeningDecision === "pending" && a.stage === "applied");
              if (pending.length === 0) return; // ux-001-ok: local no-op guard on already-loaded, already error-gated data -- renders nothing, so there's no empty-vs-error UI to confuse
              setShortlistAllBusy(true);
              // Per-row failures are already reflected in decisionStates (and the
              // per-row "Action failed" hint); this just avoids an unhandled
              // rejection when some (but not all) calls in the batch fail.
              void Promise.all(pending.map((a) => handleAction(a.id, "shortlist")))
                .catch(() => {})
                .finally(() => setShortlistAllBusy(false));
            }}
            className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-4 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {/* "…" while in flight, not a new translated string -- same
                convention ContextMenu uses for its own per-row busy state
                just above, so no new i18n key is needed across locales. */}
            {shortlistAllBusy ? "…" : t("shortlistAllPending", { count: applications.filter((a) => a.screeningDecision === "pending" && a.stage === "applied").length })}
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

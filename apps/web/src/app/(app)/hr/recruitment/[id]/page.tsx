"use client";

import { useEffect, useId, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApplicationPipeline } from "../_components/ApplicationPipeline";
import { GOIReservationCard } from "../_components/GOIReservationCard";
import { ConfirmDialog, ErrorState, useConfirmAction } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";

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
};

function ContextMenu({
  app,
  onAction,
  actionState,
}: {
  app: Application;
  onAction: (appId: string, key: string, reason?: string) => Promise<void>;
  actionState: "idle" | "submitting" | "done" | "error";
}) {
  const t = useTranslations("recruitmentDetail");
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionDef | null>(null);
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
      { label: t("actionScheduleInterview"), key: "schedule_interview", variant: "primary", disabled: true, disabledReason: t("actionScheduleInterviewDisabledReason") },
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

  const handleAction = useCallback(async (appId: string, actionKey: string, reason?: string) => {
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
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${published ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {published ? t("published") : t("notPublished")}
          </span>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STAGE_COLOR[opening.status] ?? "bg-slate-100 text-slate-700"}`}>
            {opening.status}
          </span>
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
      <GOIReservationCard totalVacancies={opening.vacancies} />

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

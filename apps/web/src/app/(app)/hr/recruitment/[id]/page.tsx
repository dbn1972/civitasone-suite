"use client";

import { useEffect, useId, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApplicationPipeline } from "../_components/ApplicationPipeline";
import { GOIReservationCard } from "../_components/GOIReservationCard";

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
type ActionDef = {
  label: string;
  key: string;
  variant: "primary" | "danger" | "ghost";
  disabled?: boolean;
  disabledReason?: string;
};

const STAGE_ACTIONS: Record<string, ActionDef[]> = {
  applied: [
    { label: "Shortlist",         key: "shortlist",   variant: "primary" },
    { label: "Reject",            key: "reject",      variant: "danger"  },
  ],
  shortlisted: [
    { label: "Schedule Interview", key: "schedule_interview", variant: "primary", disabled: true, disabledReason: "Open Interview module to schedule" },
    { label: "Reject",             key: "reject",             variant: "danger"  },
  ],
  interviewing: [
    { label: "Send Offer", key: "send_offer", variant: "primary", disabled: true, disabledReason: "Open Offer module to send" },
    { label: "Reject",     key: "reject",     variant: "danger"  },
  ],
  selected: [
    { label: "Mark Joined", key: "mark_joined", variant: "primary", disabled: true, disabledReason: "Use application detail to complete hire" },
    { label: "Withdraw",    key: "withdraw",    variant: "danger"  },
  ],
  offered: [
    { label: "Mark Joined", key: "mark_joined", variant: "primary", disabled: true, disabledReason: "Use application detail to complete hire" },
    { label: "Withdraw",    key: "withdraw",    variant: "danger"  },
  ],
  hired:     [],
  rejected:  [],
  withdrawn: [],
};

function ContextMenu({
  app,
  onAction,
  actionState,
}: {
  app: Application;
  onAction: (appId: string, key: string) => Promise<void>;
  actionState: "idle" | "submitting" | "done" | "error";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const actions = STAGE_ACTIONS[app.stage] ?? [];

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (actions.length === 0) {
    return (
      <span className="text-xs text-slate-400 italic">No actions</span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={actionState === "submitting"}
        aria-label="Application actions"
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {actionState === "submitting" ? "…" : "Actions"}
        <span aria-hidden="true" className="text-slate-400">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-xl border border-slate-200 bg-white shadow-lg py-1"
        >
          {actions.map((act) => (
            <div key={act.key} className="relative group">
              <button
                type="button"
                role="menuitem"
                disabled={act.disabled}
                onClick={async () => {
                  setOpen(false);
                  await onAction(app.id, act.key);
                }}
                className={[
                  "w-full text-left px-4 py-2 text-xs font-medium transition-colors",
                  act.disabled
                    ? "text-slate-300 cursor-not-allowed"
                    : act.variant === "danger"
                    ? "text-red-600 hover:bg-red-50"
                    : "text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {act.label}
              </button>
              {act.disabled && act.disabledReason && (
                <span
                  role="tooltip"
                  className="hidden group-hover:block absolute left-0 top-full mt-0.5 z-30 rounded-md bg-slate-800 text-white text-[10px] px-2 py-1 whitespace-nowrap shadow-lg"
                >
                  {act.disabledReason}
                </span>
              )}
            </div>
          ))}
          {actionState === "error" && (
            <p className="px-4 py-1 text-[10px] text-red-500">Action failed — try again</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobOpeningDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [opening, setOpening] = useState<JobOpening | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingOpening, setLoadingOpening] = useState(true);
  const [loadingApps, setLoadingApps] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionStates, setDecisionStates] = useState<DecisionState>({});
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");

  const searchId = useId();

  const loadOpening = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings?limit=200`, { signal });
      if (!res.ok) { setError(`Failed to load vacancy (${res.status})`); return; }
      const data = await res.json() as unknown;
      const arr: JobOpening[] = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.data as JobOpening[] ?? []);
      const found = arr.find((o) => o.id === id) ?? null;
      setOpening(found);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setError("Network error loading vacancy.");
    } finally {
      setLoadingOpening(false);
    }
  }, [id]);

  const loadApplications = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/applications`, { signal });
      if (!res.ok) { return; }
      const data = await res.json() as { data?: Application[] };
      setApplications(data.data ?? []);
    } catch {
      // Non-fatal
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

  const handleAction = useCallback(async (appId: string, actionKey: string) => {
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
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/screening-decision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "ineligible", reasonCode: "does_not_meet_eligibility" }),
        });
        if (res.ok) {
          setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, screeningDecision: "ineligible", stage: "rejected" } : a));
        }
      } else if (actionKey === "withdraw") {
        res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/stage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stage: "withdrawn" }),
        });
        if (res.ok) {
          setApplications((prev) => prev.map((a) => a.id === appId ? { ...a, stage: "withdrawn" } : a));
        }
      } else {
        // Unimplemented action — no-op
        setDecisionStates((s) => ({ ...s, [appId]: "idle" }));
        return;
      }
      setDecisionStates((s) => ({ ...s, [appId]: "done" }));
    } catch {
      setDecisionStates((s) => ({ ...s, [appId]: "error" }));
    }
  }, []);

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
      <main className="page-main">
        <p className="text-center text-slate-500 py-12">Loading vacancy…</p>
      </main>
    );
  }

  if (error ?? !opening) {
    return (
      <main className="page-main">
        <button onClick={() => router.back()} className="text-sm text-indigo-600 hover:underline mb-4 block">
          ← Back to Recruitment
        </button>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-center text-slate-400">{error ?? "Vacancy not found."}</p>
        </div>
      </main>
    );
  }

  const published = opening.isPublished === true || opening.isPublished === "true";

  return (
    <main className="page-main" aria-labelledby="page-heading">
      {/* ── Header ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => router.back()} className="text-sm text-indigo-600 hover:underline mb-1 block">
            ← Recruitment
          </button>
          <h1 id="page-heading" className="text-2xl font-bold text-slate-800">
            {opening.jobTitle}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{opening.refNo} · {opening.department ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${published ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {published ? "Published" : "Not published"}
          </span>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STAGE_COLOR[opening.status] ?? "bg-slate-100 text-slate-700"}`}>
            {opening.status}
          </span>
        </div>
      </div>

      {/* ── Vacancy meta ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Posts",         value: opening.vacancies },
          { label: "Type",          value: opening.vacancyType ?? "Regular" },
          { label: "Applications",  value: loadingApps ? "—" : applications.length },
          { label: "Deadline",      value: opening.applicationDeadline ? new Date(opening.applicationDeadline).toLocaleDateString("en-IN") : "Open" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-slate-800">{String(value)}</p>
            <p className="text-xs text-slate-500 mt-1">{label}</p>
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
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800">
            Applications Inbox
            {!loadingApps && (
              <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {filtered.length} / {applications.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <label htmlFor={searchId} className="sr-only">Search applicants</label>
            <input
              id={searchId}
              type="search"
              placeholder="Search applicants…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {stageFilter !== "all" && (
              <button
                type="button"
                onClick={() => setStageFilter("all")}
                className="text-xs text-indigo-600 hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>

        {loadingApps ? (
          <div className="px-5 py-10 text-center text-slate-500 text-sm">Loading applications…</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-slate-500 text-sm">
              {applications.length === 0
                ? "No applications received yet."
                : "No applications match the current filter."}
            </p>
            {stageFilter !== "all" && (
              <button
                type="button"
                onClick={() => setStageFilter("all")}
                className="mt-2 text-xs text-indigo-600 hover:underline"
              >
                Show all stages
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((app) => {
              const ds = decisionStates[app.id] ?? "idle";
              return (
                <div key={app.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 text-sm truncate">{app.applicantName}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {app.email}{app.mobile ? ` · ${app.mobile}` : ""}
                      </p>
                      {app.qualification && (
                        <p className="text-xs text-slate-600 mt-1">
                          {app.qualification}{app.experienceYears != null ? ` · ${app.experienceYears} yr exp` : ""}
                        </p>
                      )}
                      {(app.skills ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(app.skills ?? []).slice(0, 5).map((sk) => (
                            <span key={sk} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">{sk}</span>
                          ))}
                          {(app.skills ?? []).length > 5 && (
                            <span className="text-xs text-slate-400">+{(app.skills ?? []).length - 5} more</span>
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
                        <p className="text-xs text-slate-400">{new Date(app.appliedAt).toLocaleDateString("en-IN")}</p>
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
            onClick={() => {
              const pending = applications.filter((a) => a.screeningDecision === "pending" && a.stage === "applied");
              if (pending.length === 0) return;
              void Promise.all(pending.map((a) => handleAction(a.id, "shortlist")));
            }}
            className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            Shortlist All Pending ({applications.filter((a) => a.screeningDecision === "pending" && a.stage === "applied").length})
          </button>
          <button
            type="button"
            onClick={() => loadApplications()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      )}
    </main>
  );
}

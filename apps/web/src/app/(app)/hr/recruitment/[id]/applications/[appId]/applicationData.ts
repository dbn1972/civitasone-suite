// Data helpers for the HR application-detail page. Pure / fetch-only so they are unit-testable
// and shared by the initial load, the Retry button and the post-hire poll.

export type Application = {
  id: string;
  jobOpeningId?: string;
  /** Human-readable reference (hrms_applications.application_no); null for legacy rows. */
  applicationNo?: string | null;
  applicantName: string;
  email?: string | null;
  qualification?: string | null;
  experienceYears?: number | null;
  skills?: string[] | null;
  source: string;
  stage: string;
  status?: string;
  screeningDecision: string;
  appliedAt: string;
  /** Reservation category (e.g. UR/OBC/SC/ST/EWS), when recorded. */
  category?: string | null;
  /** ISO date; the API returns it only to hr_admin / super_admin, null for everyone else. */
  dateOfBirth?: string | null;
  hasResume?: boolean;
};

export type LoadOutcome =
  | { kind: "ok"; application: Application }
  | { kind: "notfound" }
  | { kind: "error"; response?: Response };

/** Poll cadence after a hire is queued (202): the consumer finishes asynchronously. */
export const HIRE_POLL_INTERVAL_MS = 3000;
/** Refetches before the page warns that the hire did not complete (3s x 5 = ~15s). */
export const HIRE_POLL_MAX_ATTEMPTS = 5;

/**
 * GET /v1/hrms/applications/:id (single record -- the page no longer downloads every applicant on the
 * vacancy to show one). A 404, or a record that belongs to a different vacancy than the URL names, is
 * "not found"; any other failure is an error the user can retry.
 */
export async function fetchApplicationOnce(appId: string, jobOpeningId: string): Promise<LoadOutcome> {
  try {
    const res = await fetch(`/api/proxy/v1/hrms/applications/${encodeURIComponent(appId)}`);
    if (res.status === 404) return { kind: "notfound" };
    if (!res.ok) return { kind: "error", response: res };
    const app = (await res.json()) as Application;
    if (!app || app.id !== appId) return { kind: "notfound" };
    if (app.jobOpeningId && app.jobOpeningId !== jobOpeningId) return { kind: "notfound" };
    return { kind: "ok", application: app };
  } catch {
    return { kind: "error" };
  }
}

/** True once the hire consumer has finished: the stage is read from the server, never assumed. */
export function isHireConfirmed(application: Pick<Application, "stage">): boolean {
  return application.stage === "hired";
}

export type NamedOption = { id: string; name: string };

export type LookupState = "loading" | "ready" | "error";

/** Fetches a name list (departments / designations); never falls back to free-text UUID entry. */
export async function fetchNamedList(url: string, signal?: AbortSignal): Promise<NamedOption[] | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: NamedOption[] } | NamedOption[];
    const list = Array.isArray(body) ? body : body.data;
    return Array.isArray(list) ? list : null;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return null;
  }
}

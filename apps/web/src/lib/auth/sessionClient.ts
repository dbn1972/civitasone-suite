/**
 * A11Y-01 (WCAG 2.2.1): browser-side session helpers for the session-expiry
 * warning (app/_components/session/SessionTimeoutWarning.tsx).
 *
 * The browser never sees a token: it asks /api/auth/refresh for timing (GET)
 * or to extend the session (POST; the middleware does the Keycloak call).
 * refreshSession() is single-flight per tab; across tabs the server-side
 * single-flight in lib/auth/tokenRefresh.ts makes concurrent refreshes safe.
 */
import type { SessionTimes } from "./sessionCookies";

export type { SessionTimes };

export type RefreshResult =
  | { ok: true; times: SessionTimes }
  /** expired: the session is gone (sign out). Otherwise a transient failure (keep the user here, retry). */
  | { ok: false; expired: boolean };

export const SESSION_ENDPOINT = "/api/auth/refresh";
/** localStorage key carrying the last user-activity time, so one active tab keeps the others from warning. */
export const ACTIVITY_STORAGE_KEY = "civitasone.session.lastActivity";

let inflight: Promise<RefreshResult> | null = null;

function isSessionTimes(v: unknown): v is SessionTimes {
  return !!v && typeof v === "object" && typeof (v as SessionTimes).authenticated === "boolean";
}

/** Extend the session. Concurrent callers in this tab share one request. */
export function refreshSession(): Promise<RefreshResult> {
  if (inflight) return inflight;
  const flight = (async (): Promise<RefreshResult> => {
    try {
      const res = await fetch(SESSION_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.ok && isSessionTimes(body)) return { ok: true, times: body };
      return { ok: false, expired: res.status === 401 };
    } catch {
      return { ok: false, expired: false };
    }
  })();
  inflight = flight;
  // Cleared after settling (never rejects), and only if no newer flight replaced it.
  void flight.then(() => {
    if (inflight === flight) inflight = null;
  });
  return flight;
}

/** Current session timing, or null when it can't be read right now. */
export async function fetchSessionTimes(): Promise<SessionTimes | null> {
  try {
    const res = await fetch(SESSION_ENDPOINT, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isSessionTimes(body) ? body : null;
  } catch {
    return null;
  }
}

/** Login page URL that shows "Your session expired" and returns the user here afterwards. */
export function sessionExpiredLoginUrl(returnTo: string): string {
  const next = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard";
  return `/auth/login?error=session_expired&next=${encodeURIComponent(next)}`;
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Clean sign-out after expiry: end the server session, then go to login with the message + return URL. */
export async function endExpiredSession(): Promise<void> {
  const returnTo = currentPath();
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // The login page still clears state; never block the redirect on this.
  }
  window.location.assign(sessionExpiredLoginUrl(returnTo));
}

/** Deliberate sign-out (ends the Keycloak session too; see app/logout/route.ts). */
export function signOut(): void {
  window.location.assign("/logout");
}

// localStorage can be missing or throw (private mode, blocked storage): activity
// sharing is a convenience, the per-tab timer works without it.
export function readSharedActivity(): number {
  try {
    const v = Number(window.localStorage.getItem(ACTIVITY_STORAGE_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function writeSharedActivity(at: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    // see readSharedActivity
  }
}

/** Test seam only. */
export function __resetSessionClientForTests(): void {
  inflight = null;
}

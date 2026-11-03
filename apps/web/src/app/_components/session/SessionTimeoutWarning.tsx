"use client";
/**
 * A11Y-01 (WCAG 2.2.1 Timing Adjustable, GIGW 3.0 session-timeout guidance).
 *
 * Mounted once in the app shell. It
 *  1. keeps an ACTIVE user's session alive: when the SSO session nears its end
 *     and the user has interacted since the last renewal, it silently asks the
 *     server to refresh (POST /api/auth/refresh; the middleware does the
 *     single-flight Keycloak call);
 *  2. warns an IDLE user 2 minutes before the session ends with an
 *     alertdialog (focus moved in, focus trapped, Escape = the safe choice)
 *     offering "Stay signed in" (refresh) and "Sign out";
 *  3. at the deadline, signs out cleanly (server session ended, cookies
 *     cleared) to the login page with a "session expired" message and a
 *     return URL.
 *
 * Every lifetime comes from Keycloak via the token claims (session end = the
 * refresh token's exp; idle window = its exp - iat) -- nothing is hardcoded.
 * The idle deadline is tracked here from real user input, not from requests:
 * background polling may renew tokens server-side, but must not keep an
 * unattended session open past the realm's idle timeout.
 *
 * When Keycloak's maximum session length is reached a refresh can no longer
 * extend the session; the dialog then says so and offers "Continue working"
 * (dismiss) and "Sign out now".
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "../ds";
import {
  endExpiredSession,
  fetchSessionTimes,
  readSharedActivity,
  refreshSession,
  signOut,
  writeSharedActivity,
  type SessionTimes,
} from "@/lib/auth/sessionClient";

/** Warn this long before the session ends. */
export const WARNING_LEAD_MS = 2 * 60_000;
/** An active user's session is renewed once it is within this window of its end. */
export const REFRESH_LEAD_MS = 5 * 60_000;
const TICK_MS = 1_000;
const RETRY_MS = 30_000;
const ACTIVITY_WRITE_THROTTLE_MS = 5_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

type Mode = "closed" | "idle" | "final";

/** "1 minute 5 seconds" -- read naturally by screen readers (unlike "1:05"). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  if (s > 0 || m === 0) parts.push(`${s} ${s === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

interface Tracker {
  times: SessionTimes | null;
  idleMs: number | null;
  lastActivity: number;
  lastActivityWrite: number;
  lastRefreshAt: number;
  lastAttemptAt: number;
  refreshing: boolean;
  /** Keycloak's max session length reached: refresh no longer extends it. */
  final: boolean;
  finalDismissed: boolean;
  syncing: boolean;
  ending: boolean;
  open: boolean;
}

export function SessionTimeoutWarning() {
  const [mode, setMode] = useState<Mode>("closed");
  const [remainingMs, setRemainingMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descId = useId();
  const t = useRef<Tracker>({
    times: null,
    idleMs: null,
    lastActivity: Date.now(),
    lastActivityWrite: 0,
    // The page load itself was just authenticated (and, if needed, renewed) by
    // the middleware, so only real input after this point counts as activity.
    lastRefreshAt: Date.now(),
    lastAttemptAt: 0,
    refreshing: false,
    final: false,
    finalDismissed: false,
    syncing: false,
    ending: false,
    open: false,
  });

  const applyTimes = useCallback((times: SessionTimes, fromRefresh: boolean) => {
    const tr = t.current;
    tr.times = times;
    if (times.idleTimeoutSec) tr.idleMs = Math.max(tr.idleMs ?? 0, times.idleTimeoutSec * 1000);
    if (fromRefresh) {
      const now = Date.now();
      tr.lastRefreshAt = now;
      // A refresh that cannot push the end past the renewal window means the
      // realm's maximum session length has been reached.
      tr.final = times.sessionExpiresAt !== null && times.sessionExpiresAt - now <= REFRESH_LEAD_MS;
    }
    if (!times.refreshable) tr.final = true;
  }, []);

  const deadline = useCallback((): number | null => {
    const tr = t.current;
    const times = tr.times;
    if (!times?.authenticated) return null;
    const server = times.refreshable ? times.sessionExpiresAt : times.accessExpiresAt;
    const idle = tr.idleMs !== null ? tr.lastActivity + tr.idleMs : null;
    const candidates = [server, idle].filter((v): v is number => v !== null);
    return candidates.length ? Math.min(...candidates) : null;
  }, []);

  const close = useCallback(() => {
    t.current.open = false;
    setMode("closed");
    setError(null);
  }, []);

  const expire = useCallback(() => {
    const tr = t.current;
    if (tr.ending) return;
    tr.ending = true;
    void endExpiredSession();
  }, []);

  const silentRefresh = useCallback(async () => {
    const tr = t.current;
    tr.refreshing = true;
    tr.lastAttemptAt = Date.now();
    const res = await refreshSession();
    tr.refreshing = false;
    if (res.ok) applyTimes(res.times, true);
    else if (res.expired) expire();
  }, [applyTimes, expire]);

  // Re-read the server's view (another tab may have renewed) and the shared
  // activity stamp before acting on a deadline.
  const resync = useCallback(async () => {
    const tr = t.current;
    tr.syncing = true;
    const times = await fetchSessionTimes();
    tr.syncing = false;
    if (times) applyTimes(times, false);
    tr.lastActivity = Math.max(tr.lastActivity, readSharedActivity());
  }, [applyTimes]);

  const tick = useCallback(async () => {
    const tr = t.current;
    if (tr.ending || tr.syncing) return;
    const shared = readSharedActivity();
    const otherTabActive = shared > tr.lastActivity;
    tr.lastActivity = Math.max(tr.lastActivity, shared);
    const times = tr.times;
    if (!times?.authenticated) return;
    const now = Date.now();

    // 1. Active user: renew before the end, silently.
    if (
      times.refreshable &&
      !tr.final &&
      !tr.refreshing &&
      tr.lastActivity > tr.lastRefreshAt &&
      times.sessionExpiresAt !== null &&
      times.sessionExpiresAt - now <= REFRESH_LEAD_MS &&
      now - tr.lastAttemptAt >= RETRY_MS
    ) {
      void silentRefresh();
    }

    let dl = deadline();
    if (dl === null) return;

    if (tr.open) {
      if (otherTabActive) {
        await resync();
        dl = deadline();
        if (dl !== null && dl - Date.now() > WARNING_LEAD_MS) {
          close();
          return;
        }
      }
      if (dl !== null && dl - Date.now() <= 0) {
        await resync();
        const again = deadline();
        if (again === null || again - Date.now() <= 0) expire();
        else if (again - Date.now() > WARNING_LEAD_MS) close();
        return;
      }
      if (dl !== null) setRemainingMs(dl - Date.now());
      return;
    }

    if (dl - now > WARNING_LEAD_MS) return;
    if (tr.final && tr.finalDismissed) {
      if (dl - now <= 0) expire();
      return;
    }
    // About to warn (or already past the end): confirm against fresh state first.
    await resync();
    const confirmed = deadline();
    if (confirmed === null) return;
    const left = confirmed - Date.now();
    if (left > WARNING_LEAD_MS) return;
    if (left <= 0) {
      expire();
      return;
    }
    tr.open = true;
    setRemainingMs(left);
    setMode(tr.final ? "final" : "idle");
  }, [close, deadline, expire, resync, silentRefresh]);

  // Initial timing + the 1 s clock.
  useEffect(() => {
    let cancelled = false;
    void fetchSessionTimes().then((times) => {
      if (!cancelled && times) applyTimes(times, false);
    });
    const id = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applyTimes, tick]);

  // Real user input = activity. Ignored while the warning is open so that only
  // an explicit choice in the dialog extends the session.
  useEffect(() => {
    function onActivity() {
      const tr = t.current;
      if (tr.open) return;
      const now = Date.now();
      tr.lastActivity = now;
      if (now - tr.lastActivityWrite >= ACTIVITY_WRITE_THROTTLE_MS) {
        tr.lastActivityWrite = now;
        writeSharedActivity(now);
      }
    }
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true, capture: true });
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, { capture: true });
    };
  }, []);

  const staySignedIn = useCallback(async () => {
    const tr = t.current;
    if (busy) return;
    setBusy(true);
    setError(null);
    const now = Date.now();
    tr.lastActivity = now;
    tr.lastActivityWrite = now;
    writeSharedActivity(now);
    const res = await refreshSession();
    setBusy(false);
    if (res.ok) {
      applyTimes(res.times, true);
      close();
    } else if (res.expired) {
      expire();
    } else {
      setError("We couldn’t extend your session. Check your connection, then try again.");
    }
  }, [applyTimes, busy, close, expire]);

  const continueWorking = useCallback(() => {
    t.current.finalDismissed = true;
    close();
  }, [close]);

  const open = mode !== "closed";
  const remaining = formatRemaining(remainingMs);

  return (
    <Modal
      open={open}
      role="alertdialog"
      size="sm"
      // Escape / close = the safe choice: keep the session (or just dismiss at max length).
      onClose={mode === "final" ? continueWorking : () => void staySignedIn()}
      closeOnOverlayClick={false}
      describedById={descId}
      zIndex={1200}
      title={mode === "final" ? "Your session is ending" : "Your session is about to expire"}
    >
      <div id={descId}>
        {mode === "final" ? (
          <p>
            You have reached the maximum session length, so you will be signed out in{" "}
            <strong role="timer">{remaining}</strong>. Save your work now, then sign in again to continue.
          </p>
        ) : (
          <p>
            For your security you will be signed out in <strong role="timer">{remaining}</strong> because you have
            been inactive. Choose “Stay signed in” to keep working; anything you haven’t saved stays on this page.
          </p>
        )}
      </div>
      {error ? (
        <p role="alert" className="cd-error">
          {error}
        </p>
      ) : null}
      <div className="cd-actions">
        {mode === "final" ? (
          <>
            <Button type="button" variant="primary" onClick={continueWorking}>
              Continue working
            </Button>
            <Button type="button" variant="secondary" onClick={signOut}>
              Sign out now
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="primary" onClick={() => void staySignedIn()} aria-disabled={busy} aria-busy={busy}>
              {busy ? "Extending…" : "Stay signed in"}
            </Button>
            <Button type="button" variant="secondary" onClick={signOut}>
              Sign out
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

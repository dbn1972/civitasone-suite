"use client";

/**
 * Client actions for the offline fallback page.
 *
 * GAP-OFFLINE-HOME-01: the old page offered only a <a href="/dashboard"> link,
 * which — with no cache and no network — loops the user straight back to an
 * equally-unreachable route and gives no way to retry or to leave automatically
 * once connectivity returns. This component adds:
 *   - a "Try again" button that reloads the current navigation;
 *   - an `online` listener that navigates away as soon as the network is back;
 *   - the dashboard link kept as a secondary action.
 *
 * GAP-OFFLINE-HOME-02: the page used to make an unverifiable data-safety claim
 * ("your queued changes are saved … and will sync automatically") with no count.
 * This reads the real pending-mutation count from the durable request outbox
 * (lib/sync/requestQueue.pendingRequestCount) so the user sees exactly how many
 * changes are waiting, instead of an unfalsifiable promise. Replay/idempotency
 * is owned by requestQueue.flushRequestQueue (each queued write carries an
 * x-idempotency-key); this component only reports the count.
 *
 * GAP-OFFLINE-HOME-05: a role="status" live region announces "Back online" to
 * assistive tech the moment connectivity returns, before the redirect.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { pendingRequestCount } from "@/lib/sync/requestQueue";

type QueueState = { kind: "checking" } | { kind: "known"; count: number };

export function OfflineActions() {
  const t = useTranslations("offlinePage");
  const [queue, setQueue] = useState<QueueState>({ kind: "checking" });
  const [backOnline, setBackOnline] = useState(false);

  // Report how many mutations are durably queued on this device.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const count = await pendingRequestCount();
        if (active) setQueue({ kind: "known", count });
      } catch {
        // IndexedDB unavailable (private mode / unsupported) — fall back to the
        // honest neutral copy rather than inventing a number.
        if (active) setQueue({ kind: "known", count: 0 });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // GAP-OFFLINE-HOME-01 / -05: leave automatically when the network returns.
  useEffect(() => {
    const onOnline = () => {
      setBackOnline(true);
      // Give the live region a tick to announce before navigating away.
      window.setTimeout(() => {
        window.location.assign("/dashboard");
      }, 600);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const onRetry = useCallback(() => {
    window.location.reload();
  }, []);

  const queueMessage =
    queue.kind === "checking"
      ? t("queuedChecking")
      : queue.count === 0
        ? t("queuedNone")
        : queue.count === 1
          ? t("queuedOne")
          : t("queuedMany", { count: queue.count });

  return (
    <div style={{ marginTop: 16 }}>
      <p
        data-testid="offline-queue"
        style={{ color: "var(--ink2)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}
      >
        {queueMessage}
      </p>

      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn primary" onClick={onRetry}>
          {t("tryAgain")}
        </button>
        <a className="btn ghost" href="/dashboard">
          {t("goToDashboard")}
        </a>
      </div>

      {/* GAP-OFFLINE-HOME-05: announced to screen readers on reconnect. */}
      <p role="status" aria-live="polite" style={{ marginTop: 16, minHeight: 20, color: "var(--good)", fontSize: 13 }}>
        {backOnline ? t("backOnline") : ""}
      </p>
    </div>
  );
}

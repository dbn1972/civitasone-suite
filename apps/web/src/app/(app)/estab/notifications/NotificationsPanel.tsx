"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ErrorState, SkeletonCard } from "../../../_components/ds";

/**
 * Severity → design-system token classes. GAP-ESTAB-NOTIFICATIONS-03: the panel
 * previously hard-coded hex (#fef2f2 …) inline, which ignored dark mode and the
 * token palette. Each severity now maps to the shared pill token trio
 * (bg/border/accent) defined in civitas-ds.css (--badbg/--badbd/--bad, …), so
 * contrast is correct in both themes.
 */
const SEV_TOKENS: Record<string, { bg: string; border: string; accent: string }> = {
  critical: { bg: "var(--badbg)", border: "var(--badbd)", accent: "var(--bad)" },
  warning: { bg: "var(--warnbg)", border: "var(--warnbd)", accent: "var(--warn)" },
  info: { bg: "var(--infobg)", border: "var(--infobd)", accent: "var(--info)" },
};

const SEVERITY = z.enum(["info", "warning", "critical"]);

// GAP-ESTAB-NOTIFICATIONS-02/05: validate the payload at the fetch boundary so a
// malformed row (missing link, unknown severity) cannot crash <Link> or render
// an unexpected shape. Unknown severities are coerced to "info" via catch.
const NotificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: SEVERITY.catch("info"),
  title: z.string(),
  detail: z.string().default(""),
  at: z.string(),
  link: z.string().optional().default(""),
});
type Notification = z.infer<typeof NotificationSchema>;

const ResponseSchema = z.object({
  data: z.array(NotificationSchema).default([]),
  total: z.number().int().nonnegative().optional(),
});

const LIMIT = 80;
const REFRESH_MS = 60_000;

/**
 * GAP-ESTAB-NOTIFICATIONS-02: only an in-app absolute path ("/estab/…") is
 * turned into a navigable <Link>. A protocol-relative ("//evil"), absolute
 * ("https://…"), "javascript:" or empty link from the feed is rendered as plain
 * (non-navigable) content, so a malformed/compromised payload can never
 * navigate off-app. Mirrors crm/control-tower/ExceptionTable's isSafeInternalHref.
 */
export function isSafeInternalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function RowBody({ n }: { n: Notification }) {
  const s = SEV_TOKENS[n.severity] ?? SEV_TOKENS.info!;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <span
        style={{ width: 10, height: 10, borderRadius: "50%", background: s.accent, marginTop: 5, flexShrink: 0 }}
        aria-hidden="true"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.9375rem", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* Severity by text + colour, never colour alone (WCAG). */}
          <span style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: s.accent }}>
            {n.severity}
          </span>
          <span>{n.title}</span>
        </div>
        <div style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>{n.detail}</div>
      </div>
      <time dateTime={n.at} style={{ fontSize: "0.75rem", color: "var(--mut)", whiteSpace: "nowrap" }}>
        {formatIndianDateTime(n.at)}
      </time>
    </div>
  );
}

export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  // Only the first load shows the skeleton; background refreshes keep the list.
  const didLoadOnce = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!didLoadOnce.current) setLoading(true);
    try {
      const res = await fetch(`/api/proxy/v1/estab/notifications?limit=${LIMIT}`, { signal });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      const parsed = ResponseSchema.parse(await res.json());
      setItems(parsed.data);
      setError("");
      setLastLoadedAt(new Date());
      didLoadOnce.current = true;
    } catch (err) {
      // An abort means the panel unmounted (or a newer load superseded this
      // one) while the request was in flight -- painting this stale attempt's
      // error state would be wrong.
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + background refresh. GAP-ESTAB-NOTIFICATIONS-01: an officer
  // used to see overdue files only on a fresh page open. The panel now refetches
  // on an interval and when the tab regains focus/visibility, and stamps when it
  // last loaded. The interval is paused while the tab is hidden to avoid polling
  // the estab-service for a backgrounded tab, and cleared on unmount.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer === null) timer = setInterval(() => void load(), REFRESH_MS);
    };
    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        startTimer();
      } else {
        stopTimer();
      }
    };
    const onFocus = () => void load();

    if (document.visibilityState === "visible") startTimer();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      controller.abort();
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const atCap = items.length >= LIMIT;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--mut)" }} aria-live="polite">
          {lastLoadedAt ? `Updated ${formatIndianDateTime(lastLoadedAt)} IST` : ""}
        </span>
        <button type="button" className="btn ghost" onClick={() => void load()} aria-label="Refresh notifications">
          Refresh
        </button>
      </div>

      {loading ? (
        <div aria-busy="true" aria-label="Loading notifications…" style={{ display: "grid", gap: 10 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        // A failed load must NOT show "All clear" — that would tell an officer
        // nothing is pending when we simply couldn't check.
        <div className="card">
          <div className="pad">
            <ErrorState error={toHumanError("load", { area: "notifications" })} onRetry={() => void load()} />
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="pad" style={{ color: "var(--mut)" }}>All clear — nothing needs your attention.</p>
        </div>
      ) : (
        <div aria-live="polite" aria-atomic="false" style={{ display: "grid", gap: 10 }}>
          {items.map((n) => {
            const safe = n.link !== "" && isSafeInternalPath(n.link);
            const ariaLabel = `${n.severity}: ${n.title}, ${formatIndianDateTime(n.at)}`;
            return safe ? (
              <Link key={n.id} href={n.link} aria-label={ariaLabel} style={{ textDecoration: "none", color: "inherit" }}>
                <RowBody n={n} />
              </Link>
            ) : (
              <div key={n.id} aria-label={ariaLabel}>
                <RowBody n={n} />
              </div>
            );
          })}
          {atCap ? (
            <p role="note" style={{ fontSize: "0.75rem", color: "var(--mut)", textAlign: "center", marginTop: 4 }}>
              Showing the latest {LIMIT} notifications. Older items may not be listed.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

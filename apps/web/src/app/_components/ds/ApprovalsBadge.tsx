"use client";

/**
 * UX R1: the sidebar count for Approvals. It is the SAME number as the inbox "Waiting for me" tab:
 * both come from GET /v1/workflow/inbox/counts (waiting), and while the inbox is open it pushes its
 * own counts (after every decision) through the COUNTS_EVENT window event, so the two never differ.
 * Fetched at most once a minute per tab session; fails silent (no badge rather than a wrong one).
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { COUNTS_EVENT, type InboxCounts } from "@/app/(app)/approvals/_lib/inboxModel";

const MAX_AGE_MS = 60_000;

function useSafeBadgeLabel(): (count: number) => string {
  try {
    const t = useTranslations("approvalsInbox");
    return (count) => t("badge", { count });
  } catch {
    return (count) => `${count} waiting for you`;
  }
}

function readCached(): InboxCounts | null {
  try {
    const raw = window.sessionStorage.getItem(COUNTS_EVENT);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; counts?: InboxCounts };
    return v.at && Date.now() - v.at < MAX_AGE_MS && v.counts ? v.counts : null;
  } catch {
    return null;
  }
}

export function ApprovalsBadge() {
  const label = useSafeBadgeLabel();
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    const onCounts = (e: Event) => {
      const c = (e as CustomEvent<InboxCounts>).detail;
      if (c && typeof c.waiting === "number") setWaiting(c.waiting);
    };
    window.addEventListener(COUNTS_EVENT, onCounts);
    const cached = readCached();
    if (cached) {
      setWaiting(cached.waiting);
    } else {
      const ac = new AbortController();
      fetch("/api/proxy/v1/workflow/inbox/counts", { signal: ac.signal })
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as { data?: InboxCounts };
          if (body.data && typeof body.data.waiting === "number") {
            setWaiting(body.data.waiting);
            try { window.sessionStorage.setItem(COUNTS_EVENT, JSON.stringify({ at: Date.now(), counts: body.data })); } catch { /* ignore */ }
          }
        })
        .catch(() => undefined);
      return () => { ac.abort(); window.removeEventListener(COUNTS_EVENT, onCounts); };
    }
    return () => window.removeEventListener(COUNTS_EVENT, onCounts);
  }, []);

  if (waiting === null || waiting <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="approvals-badge"
        style={{ marginInlineStart: "auto", minWidth: 22, padding: "1px 7px", borderRadius: 11, background: "var(--primary)", color: "var(--on-primary)", fontSize: 12, fontWeight: 700, textAlign: "center" }}
      >
        {waiting}
      </span>
      <span className="sr-only">{label(waiting)}</span>
    </>
  );
}

"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSSEConnection } from "./useSSEConnection";
import { SSEConnectionStatus } from "./SSEConnectionStatus";

export interface Notification {
  id: string;
  title: string;
  body?: string;
  description?: string;
  module?: string;
  time: string;
  createdAt?: string;
  read: boolean;
  icon?: string;
}

interface NotificationBellProps {
  notifications?: Notification[];
  unreadCount?: number;
  /** SSE stream URL — defaults to /api/proxy/notifications/v1/notifications/stream */
  streamUrl?: string;
  /** Whether to show the SSE connection status indicator. Default: true */
  showConnectionStatus?: boolean;
}

/** Max items to show in the dropdown */
const MAX_DROPDOWN_ITEMS = 20;
/** Max unread count to display (cap at 99+) */
const MAX_DISPLAY_COUNT = 99;

const MODULE_ICONS: Record<string, string> = {
  workflow: "📋",
  finance: "💰",
  procurement: "🛒",
  hrms: "👤",
  payroll: "💳",
  audit: "🔍",
  notification: "🔔",
  legal: "⚖️",
  project: "📊",
  estab: "📁",
  asset: "🏢",
  citizen: "👥",
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function truncateBody(text: string, maxLength = 60): string {
  if (!text || text.length <= maxLength) return text || "";
  return text.substring(0, maxLength).trimEnd() + "…";
}

function formatBadgeCount(count: number): string {
  return count > MAX_DISPLAY_COUNT ? "99+" : String(count);
}

export function NotificationBell({ notifications: propNotifications, unreadCount, streamUrl, showConnectionStatus = true }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>(propNotifications ?? []);
  const [localUnreadCount, setLocalUnreadCount] = useState<number>(unreadCount ?? 0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // SSE connection with exponential backoff reconnection
  const sseEnabled = !propNotifications;
  const sseUrl = streamUrl ?? "/api/proxy/notifications/v1/notifications/stream";

  const handleSSEEvent = useCallback((_eventType: string, data: unknown) => {
    try {
      const payload = data as {
        id: string;
        type?: string;
        title: string;
        body?: string;
        metadata?: Record<string, unknown>;
        createdAt?: string;
      };
      const newNotification: Notification = {
        id: payload.id,
        title: payload.title,
        body: payload.body,
        description: payload.body,
        module: payload.type?.split(".")[0] ?? "notification",
        time: payload.createdAt ? formatRelativeTime(payload.createdAt) : "Just now",
        createdAt: payload.createdAt,
        read: false,
        icon: MODULE_ICONS[payload.type?.split(".")[0] ?? ""] ?? "🔔",
      };
      setItems((prev) => [newNotification, ...prev].slice(0, MAX_DROPDOWN_ITEMS));
      setLocalUnreadCount((prev) => prev + 1);
    } catch {
      // Ignore malformed SSE data
    }
  }, []);

  const { state: sseConnectionState } = useSSEConnection({
    url: sseUrl,
    enabled: sseEnabled,
    onEvent: handleSSEEvent,
  });

  // Fetch recent notifications from notification-service on mount
  useEffect(() => {
    if (propNotifications) {
      setItems(propNotifications);
      setLocalUnreadCount(unreadCount ?? propNotifications.filter((n) => !n.read).length);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/proxy/notifications/v1/notifications/stream/unread?limit=20", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: Array<{ id: string; type?: string; title: string; body?: string; metadata?: Record<string, unknown>; createdAt?: string; readAt?: string | null }> } | unknown;
        const data = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data ?? [];
        if (active) {
          const mapped = (data as Array<{ id: string; type?: string; title: string; body?: string; metadata?: Record<string, unknown>; createdAt?: string; readAt?: string | null }>)
            .slice(0, MAX_DROPDOWN_ITEMS)
            .map((n) => ({
              id: n.id,
              title: n.title ?? "Notification",
              body: n.body ?? undefined,
              description: n.body ?? undefined,
              module: n.type?.split(".")[0] ?? "notification",
              time: n.createdAt ? formatRelativeTime(n.createdAt) : "",
              createdAt: n.createdAt,
              read: !!n.readAt,
              icon: MODULE_ICONS[n.type?.split(".")[0] ?? ""] ?? "🔔",
            }));
          setItems(mapped);
          setLocalUnreadCount(mapped.filter((n) => !n.read).length);
        }
      } catch {
        // Silently degrade — bell shows empty
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [propNotifications, unreadCount]);

  // Mark notification as read (within 1s target)
  const markAsRead = useCallback(async (notificationId: string) => {
    // Optimistic update
    setItems((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
    );
    setLocalUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      await fetch("/api/proxy/notifications/v1/notifications/stream/mark-read", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
    } catch {
      // Revert on failure
      setItems((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n)),
      );
      setLocalUnreadCount((prev) => prev + 1);
    }
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    const prevItems = items;
    const prevCount = localUnreadCount;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setLocalUnreadCount(0);

    try {
      await fetch("/api/proxy/notifications/v1/notifications/stream/mark-read", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      setItems(prevItems);
      setLocalUnreadCount(prevCount);
    }
  }, [items, localUnreadCount]);

  const count = unreadCount ?? localUnreadCount;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      {showConnectionStatus && sseEnabled && (
        <SSEConnectionStatus connectionState={sseConnectionState} />
      )}
      <button
        onClick={() => setOpen(!open)}
        type="button"
        className="iconbtn"
        title="Notifications"
        aria-label={`Notifications${count > 0 ? `, ${formatBadgeCount(count)} unread` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        style={{ position: "relative" }}
      >
        🔔
        {count > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              background: "#ef4444",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 9,
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            {formatBadgeCount(count)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 380,
            background: "var(--surface, #fff)",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
            border: "1px solid var(--border, #e5e7eb)",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-light, #f1f5f9)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>
              Notifications
            </span>
            {count > 0 && (
              <button
                onClick={markAllAsRead}
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 11,
                  color: "var(--primary, #4f46e5)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {loading && items.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-muted, #94a3b8)", fontSize: 13 }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-muted, #94a3b8)", fontSize: 13 }}>
                No notifications yet
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => {
                    if (!n.read) void markAsRead(n.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !n.read) void markAsRead(n.id);
                  }}
                  style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border-light, #f8fafc)",
                    display: "flex",
                    gap: 10,
                    background: n.read ? "transparent" : "var(--highlight, #f0f9ff)",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{n.icon ?? "🔔"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: n.read ? 400 : 600,
                        color: "var(--text-primary, #1e293b)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {n.title}
                    </div>
                    {(n.body || n.description) && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-secondary, #64748b)",
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {truncateBody(n.body || n.description || "")}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      {n.module && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            background: "var(--badge-bg, #e2e8f0)",
                            color: "var(--badge-text, #475569)",
                            borderRadius: 4,
                            padding: "1px 5px",
                            textTransform: "capitalize",
                          }}
                        >
                          {n.module}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
                        {n.time}
                      </span>
                    </div>
                  </div>
                  {!n.read && (
                    <span
                      aria-label="Unread"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: "var(--primary, #4f46e5)",
                        flexShrink: 0,
                        marginTop: 4,
                      }}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--border-light, #f1f5f9)",
              textAlign: "center",
            }}
          >
            <Link
              href="/approvals"
              style={{
                fontSize: 12,
                color: "var(--primary, #4f46e5)",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              View My Approvals
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

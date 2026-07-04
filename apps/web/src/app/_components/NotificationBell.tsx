"use client";

import React, { useState, useRef, useEffect } from "react";

export interface Notification {
  id: string;
  title: string;
  description?: string;
  time: string;
  read: boolean;
  icon?: string;
}

interface NotificationBellProps {
  notifications?: Notification[];
  unreadCount?: number;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function NotificationBell({ notifications: propNotifications, unreadCount }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch from notification-service inbox on mount
  useEffect(() => {
    if (propNotifications) return; // skip fetch if props provided
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/proxy/notifications/notifications?limit=10", { credentials: "same-origin" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: Array<{ id: string; title: string; message?: string; createdAt?: string; status?: string }> } | unknown;
        const data = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data ?? [];
        if (active) {
          setFetched((data as Array<{ id: string; title: string; message?: string; createdAt?: string; status?: string }>).map((n) => ({
            id: n.id,
            title: n.title ?? "Notification",
            description: n.message ?? undefined,
            time: n.createdAt ? formatRelativeTime(n.createdAt) : "",
            read: n.status === "read",
          })));
        }
      } catch {
        // Silently degrade — bell shows empty
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [propNotifications]);

  const items = propNotifications ?? fetched;
  const count = unreadCount ?? items.filter((n) => !n.read).length;

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
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        type="button"
        className="iconbtn"
        title="Notifications"
        style={{ position: "relative" }}
      >
        🔔
        {count > 0 && (
          <span
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
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 340,
            background: "#fff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
            border: "1px solid #e5e7eb",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>Notifications</span>
            <span style={{ fontSize: 11, color: "#4f46e5", cursor: "pointer" }}>Mark all read</span>
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {items.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid #f8fafc",
                  display: "flex",
                  gap: 10,
                  background: n.read ? "transparent" : "#f0f9ff",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{n.icon ?? "🔔"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: "#1e293b" }}>
                    {n.title}
                  </div>
                  {n.description && (
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>
                      {n.description}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{n.time}</div>
                </div>
                {!n.read && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: "#4f46e5",
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid #f1f5f9",
              textAlign: "center",
              fontSize: 12,
              color: "#4f46e5",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            View all notifications
          </div>
        </div>
      )}
    </div>
  );
}

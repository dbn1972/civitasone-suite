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

const SAMPLE_NOTIFICATIONS: Notification[] = [
  { id: "1", title: "Budget sanction approved", description: "FY 2026-27 Q2 allocation", time: "2 min ago", read: false, icon: "✅" },
  { id: "2", title: "New leave request", description: "Rajesh Kumar requested 3 days CL", time: "15 min ago", read: false, icon: "🏖️" },
  { id: "3", title: "Payment processed", description: "₹2,45,000 credited to vendor", time: "1 hr ago", read: true, icon: "💳" },
  { id: "4", title: "Milestone overdue", description: "Phase 2 - Road Construction", time: "3 hrs ago", read: true, icon: "⚠️" },
  { id: "5", title: "Audit observation", description: "Pending response for Query #42", time: "Yesterday", read: true, icon: "📋" },
];

export function NotificationBell({ notifications, unreadCount }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = notifications ?? SAMPLE_NOTIFICATIONS;
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Notification = {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  at: string;
  link: string;
};

const SEV_STYLE: Record<string, { bg: string; border: string; dot: string }> = {
  critical: { bg: "#fef2f2", border: "#fecaca", dot: "#dc2626" },
  warning: { bg: "#fffbeb", border: "#fde68a", dot: "#d97706" },
  info: { bg: "#eff6ff", border: "#bfdbfe", dot: "#2563eb" },
};

export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/notifications?limit=80");
      if (!res.ok) throw new Error(await res.text());
      setItems(((await res.json()) as { data?: Notification[] }).data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ marginTop: 18 }}>
      {error ? <p style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{error}</p> : null}
      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
      ) : items.length === 0 ? (
        <div className="card"><p className="pad" style={{ color: "#94a3b8" }}>All clear — nothing needs your attention.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((n) => {
            const s = SEV_STYLE[n.severity] ?? SEV_STYLE.info!;
            return (
              <Link key={n.id} href={n.link} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "12px 14px",
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.dot, marginTop: 5, flexShrink: 0 }} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{n.title}</div>
                    <div style={{ fontSize: "0.8125rem", color: "#475569" }}>{n.detail}</div>
                  </div>
                  <time style={{ fontSize: "0.75rem", color: "#94a3b8", whiteSpace: "nowrap" }}>
                    {new Date(n.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </time>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

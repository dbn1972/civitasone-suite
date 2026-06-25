"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Segmented, ConfirmDialog, DataTable } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type Session = {
  id: string;
  userEmail: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  lastActiveAt: string;
  mfaVerified: boolean;
  status: "active" | "expired" | "revoked";
} & Record<string, unknown>;

const FILTERS = ["All", "Active", "Revoked"] as const;

/** Derive a friendly device label from a User-Agent string. */
function deviceLabel(ua?: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Best-effort location hint from the IP (network prefix). */
function locationLabel(ip?: string): string {
  if (!ip) return "—";
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) return "Internal network";
  return `${ip.split(".").slice(0, 2).join(".")}.x.x`;
}

export function SessionsTable({ sessions }: { sessions: Session[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("All");
  const [pending, setPending] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => {
    if (filter === "All") return sessions;
    return sessions.filter((s) => s.status === filter.toLowerCase());
  }, [sessions, filter]);

  async function revoke(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/identity/sessions/${pending.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || `Request failed (${res.status})`;
        try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* */ }
        throw new Error(msg);
      }
      setNotice(`Session for ${pending.userName ?? pending.userEmail} revoked.`);
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke session. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="sessions-table-heading">Session log</h3>
        <div role="group" aria-label="Filter sessions by status">
          <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
        </div>
      </div>
      {notice ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "#067647", margin: 0, padding: "8px 16px 0" }}>{notice}</p>
      ) : null}
      <DataTable<Session>
        columns={[
          {
            key: "userEmail",
            label: "User",
            render: (s) => (
              <div className="who">
                <div className="av" aria-hidden="true">{(s.userName ?? s.userEmail).slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="nm">{s.userName ?? "—"}</div>
                  <div className="ml">{s.userEmail}</div>
                </div>
              </div>
            ),
          },
          { key: "userAgent", label: "Device", render: (s) => deviceLabel(s.userAgent) },
          {
            key: "ipAddress",
            label: "Location",
            render: (s) => (
              <>
                {locationLabel(s.ipAddress)}
                {s.ipAddress ? <div style={{ fontSize: 11, color: "#98a2b3" }}><span className="mono">{s.ipAddress}</span></div> : null}
              </>
            ),
          },
          { key: "lastActiveAt", label: "Last active", render: (s) => formatIndianDate(s.lastActiveAt) },
          { key: "mfaVerified", label: "MFA", render: (s) => (s.mfaVerified ? <span className="pill good">Yes</span> : <span className="pill mut">No</span>) },
          {
            key: "status",
            label: "Status",
            render: (s) =>
              s.status === "active" ? <span className="pill good">Active</span>
                : s.status === "revoked" ? <span className="pill bad">Revoked</span>
                : <span className="pill mut">Expired</span>,
          },
          {
            key: "id",
            label: "Actions",
            sortable: false,
            render: (s) =>
              s.status === "active"
                ? (
                  <button type="button" className="btn danger sm" disabled={busy} onClick={() => { setError(undefined); setPending(s); }}>
                    Revoke
                  </button>
                )
                : <span style={{ fontSize: 12, color: "#98a2b3" }}>—</span>,
          },
        ]}
        rows={rows}
      />

      <ConfirmDialog
        open={pending !== null}
        title="Revoke this session?"
        description={
          <>
            This signs out <b>{pending?.userName ?? pending?.userEmail}</b> on <b>{deviceLabel(pending?.userAgent)}</b> immediately.
            They will need to sign in again. This cannot be undone.
          </>
        }
        confirmLabel="Revoke session"
        danger
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void revoke(reason)}
        onCancel={() => { if (!busy) { setPending(null); setError(undefined); } }}
      />
    </div>
  );
}

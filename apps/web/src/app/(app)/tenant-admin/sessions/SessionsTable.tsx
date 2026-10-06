"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Segmented, ConfirmDialog, DataTable } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { networkLabel } from "./sessionHelpers";

type Session = {
  id: string;
  userId?: string;
  userEmail: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  lastActiveAt: string;
  mfaVerified: boolean;
  status: "active" | "expired" | "revoked";
} & Record<string, unknown>;

// GAP-TENANT-ADMIN-SESSIONS-05: "Expired" sessions were only visible under
// "All"; a Session.status can be expired, so it gets its own filter.
const FILTERS = ["All", "Active", "Revoked", "Expired"] as const;

/** Derive a friendly device label from a User-Agent string. */
function deviceLabel(ua?: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export function SessionsTable({ sessions, currentUserId }: { sessions: Session[]; currentUserId?: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("All");
  const [pending, setPending] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const formError = useFormError("session");

  const rows = useMemo(() => {
    if (filter === "All") return sessions;
    return sessions.filter((s) => s.status === filter.toLowerCase());
  }, [sessions, filter]);

  function isOwnSession(s: Session): boolean {
    return currentUserId != null && s.userId != null && s.userId === currentUserId;
  }

  async function revoke(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/identity/sessions/${pending.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setNotice(`Session for ${pending.userName ?? pending.userEmail} revoked.`);
      setPending(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
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
        caption="Active and recent sessions"
        columns={[
          {
            key: "userEmail",
            label: "User",
            render: (s) => (
              <div className="who">
                <div className="av" aria-hidden="true">{(s.userName ?? s.userEmail).slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="nm">
                    {s.userName ?? "—"}
                    {isOwnSession(s) ? <span className="pill info" style={{ marginInlineStart: 6, fontSize: 10.5 }}>This session</span> : null}
                  </div>
                  <div className="ml">{s.userEmail}</div>
                </div>
              </div>
            ),
          },
          { key: "userAgent", label: "Device", render: (s) => <span title={s.userAgent ?? undefined}>{deviceLabel(s.userAgent)}</span> },
          {
            key: "ipAddress",
            // GAP-TENANT-ADMIN-SESSIONS-05: this is a coarse NETWORK, not a
            // geographic location — label it "Network" and keep it in step
            // with the "Distinct networks" KPI (shared networkLabel).
            label: "Network",
            render: (s) => (
              <>
                {networkLabel(s.ipAddress)}
                {s.ipAddress ? <div style={{ fontSize: 11, color: "var(--mut)" }}><span className="mono">{s.ipAddress}</span></div> : null}
              </>
            ),
          },
          // GAP-TENANT-ADMIN-SESSIONS-04: a security screen needs the time of
          // last activity, not just the date.
          { key: "lastActiveAt", label: "Last active", render: (s) => formatIndianDateTime(s.lastActiveAt) },
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
            render: (s) => (
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <Link href={`/tenant-admin/sessions/${s.id}`} className="btn ghost sm" aria-label={`View session for ${s.userName ?? s.userEmail}`}>
                  View
                </Link>
                {s.status === "active" && !isOwnSession(s)
                  ? (
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => { setError(undefined); setPending(s); }}>
                      Revoke
                    </Button>
                  )
                  : s.status === "active" && isOwnSession(s)
                    ? <span style={{ fontSize: 12, color: "var(--mut)" }} title="You cannot revoke your own current session here.">Current</span>
                    : null}
              </div>
            ),
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

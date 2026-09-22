"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, StatusPill, Segmented, ConfirmDialog, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useFormError } from "@/lib/useFormError";

type AdminUser = {
  id: string;
  name?: string | null;
  email: string;
  roles: string[];
  mfaEnabled: boolean;
  status: string;
} & Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILTERS = ["All", "Active", "Suspended"] as const;

export function UsersTable({ users, source = "api" }: { users: AdminUser[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AdminUser[]>(
    "tenantAdmin.users",
    users,
    source,
    (d) => d.length === 0,
  );

  const [filter, setFilter] = useState<string>("All");
  const [inviteOpen, setInviteOpen] = useState(false);

  const visible = useMemo(() => {
    if (filter === "All") return rows;
    return rows.filter((u) => u.status === filter.toLowerCase());
  }, [rows, filter]);

  // Bug B (fix/tenant-admin-and-establishment-nav): "0 users" here is a real,
  // correctly-authenticated, correctly-tenant-scoped 0 -- live-verified via a
  // real uxtester token against GET /identity/users (both the identity-svc
  // route and the gateway's /v1/admin/users alias): 200 OK, genuinely empty
  // array. Not a fetch failure masquerading as 0 (that class of bug is a
  // shared StatCard/fallback concern tracked separately). The real, page-
  // specific gap: identity-service's user directory is populated ONLY by
  // this page's own "+ Invite User" flow (a command -> async DB projection);
  // it never reads or syncs Keycloak's realm users. So an account created
  // directly in Keycloak (as uxtester was, for UAT) has no directory row and
  // never will until invited here -- even though they are clearly a real,
  // authenticated user of this exact tenant. DataTable's generic "No records
  // found" default doesn't explain any of that, so replace it with an honest,
  // actionable message -- but ONLY when the fetch genuinely succeeded with
  // zero rows (provenance === "live", the same single source of truth the
  // DataSourceBadge above already reads -- UX-002's "never a second,
  // independently-derived provenance" rule applies here too). A fetch that
  // actually FAILED resolves to "error-no-data" (verified live: a rejected
  // token produces exactly this), and must keep showing the generic message
  // instead -- the Keycloak-sync explanation would be actively misleading
  // for a plain network/auth failure that has nothing to do with Keycloak
  // sync. That failure case is already honestly surfaced by the badge above,
  // which is the one place this file reports provenance (per the UX-012
  // comment below) -- caught live during browser verification, not by the
  // unit tests below, which is why there's now a regression test for it too.
  const directoryEmpty = rows.length === 0 && (provenance ?? "live") === "live";

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="users-table-heading">User directory</h3>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <div role="group" aria-label="Filter users by status">
            <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>+ Invite User</Button>
        </div>
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<AdminUser>
        rowHref={(user) => `/tenant-admin/users/${user.id}`}
        // REL-023: without this, the row-link's aria-label fell back to
        // `columns[0].key` (email) -- "Open admin@example.com" instead of
        // "Open Admin User" -- so a11y tooling and role-based lookups keyed
        // on the person's name (the actual identifying value here) couldn't
        // find the link at all. See DataTable's identifyingColumnKey doc.
        identifyingColumnKey="name"
        columns={[
          {
            key: "email",
            label: "User",
            render: (user) => (
              <div className="who">
                <div className="av" aria-hidden="true">{(user.name ?? user.email).slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="nm">{user.name ?? "—"}</div>
                  <div className="ml">{user.email}</div>
                </div>
              </div>
            ),
          },
          { key: "department", label: "Department", sortable: false, render: () => "—" },
          { key: "roles", label: "Role", render: (user) => (user.roles.length > 0 ? user.roles[0] : "—") },
          {
            key: "mfaEnabled",
            label: "SSO / MFA",
            render: (user) =>
              user.mfaEnabled ? <span className="pill good">MFA on</span> : <span className="pill mut">MFA off</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (user) =>
              user.status === "active" ? <span className="pill good">Active</span>
                : user.status === "suspended" ? <span className="pill bad">Suspended</span>
                : user.status === "inactive" ? <span className="pill mut">Inactive</span>
                : <StatusPill status={user.status} label={user.status.replace(/_/g, " ")} />,
          },
        ]}
        rows={visible}
        sortable
        filterable
        filterPlaceholder="Search users…"
        pageSize={10}
        {...(directoryEmpty
          ? {
              emptyIcon: "👥",
              emptyTitle: "No users in this directory yet",
              emptyMessage:
                "Accounts created directly in Keycloak (e.g. for initial setup) aren't synced here automatically — invite each teammate below to add them to this tenant's directory.",
              // Distinct label from the toolbar's own "+ Invite User" button
              // (same click handler) -- two same-named buttons on one page
              // would be ambiguous both for screen-reader users navigating by
              // name and for role+name test queries like the one already in
              // UsersTable.test.tsx.
              emptyAction: (
                <Button size="sm" onClick={() => setInviteOpen(true)}>+ Invite your first user</Button>
              ),
            }
          : {})}
      />

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => { setInviteOpen(false); router.refresh(); }}
      />
    </div>
  );
}

function InviteUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [empCode, setEmpCode] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("invitation");

  const nameId = useId();
  const emailId = useId();
  const empId = useId();

  function reset() {
    setName(""); setEmail(""); setEmpCode("");
    setNameErr(""); setEmailErr(""); setError(undefined);
  }

  async function submit(): Promise<void> {
    let ok = true;
    setNameErr(""); setEmailErr("");
    if (name.trim().length === 0) { setNameErr("Name is required."); ok = false; }
    if (!EMAIL_RE.test(email.trim())) { setEmailErr("Enter a valid email address."); ok = false; }
    if (!ok) throw new Error("Please correct the highlighted fields.");
    formError.clear();
    const res = await fetch("/api/proxy/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        ...(empCode.trim() ? { empCode: empCode.trim() } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error((await formError.fromResponse(res, "save")).message);
    }
    reset();
  }

  if (!open) return null;

  return (
    <ConfirmDialog
      open={open}
      title="Invite a user"
      description={
        <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
          <div>
            <label htmlFor={nameId} style={dlgLbl}>Full name</label>
            <input id={nameId} value={name} onChange={(e) => setName(e.target.value)}
              aria-invalid={nameErr ? true : undefined} placeholder="Asha Verma" style={dlgInp} />
            {nameErr ? <p role="alert" style={dlgErr}>{nameErr}</p> : null}
          </div>
          <div>
            <label htmlFor={emailId} style={dlgLbl}>Email</label>
            <input id={emailId} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailErr ? true : undefined} placeholder="asha@gov.in" style={dlgInp} />
            {emailErr ? <p role="alert" style={dlgErr}>{emailErr}</p> : null}
          </div>
          <div>
            <label htmlFor={empId} style={dlgLbl}>Employee code <span style={{ fontWeight: 400, color: "var(--mut)" }}>(optional)</span></label>
            <input id={empId} value={empCode} onChange={(e) => setEmpCode(e.target.value)}
              placeholder="EMP-00123" style={dlgInp} />
          </div>
        </div>
      }
      confirmLabel="Send invite"
      busy={busy}
      errorMessage={error}
      onConfirm={async () => {
        setBusy(true);
        setError(undefined);
        try {
          await submit();
          onCreated();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to invite user.");
        } finally {
          setBusy(false);
        }
      }}
      onCancel={() => { if (!busy) { reset(); onClose(); } }}
    />
  );
}

const dlgLbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 5 };
const dlgInp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)" };
const dlgErr: React.CSSProperties = { color: "#b42318", fontSize: 12, margin: "4px 0 0" };

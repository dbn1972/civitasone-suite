"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Segmented, ConfirmDialog } from "../../../_components/ds";

type Role = {
  id: string;
  name: string;
  description?: string;
  isSystemRole: boolean;
  userCount: number;
};

const FILTERS = ["All", "System", "Custom"] as const;

export function RolesTable({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("All");
  const [createOpen, setCreateOpen] = useState(false);

  const visible = useMemo(() => {
    if (filter === "System") return roles.filter((r) => r.isSystemRole);
    if (filter === "Custom") return roles.filter((r) => !r.isSystemRole);
    return roles;
  }, [roles, filter]);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="roles-table-heading">Role definitions</h3>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <div role="group" aria-label="Filter roles by type">
            <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
          </div>
          <button type="button" className="btn primary sm" onClick={() => setCreateOpen(true)}>+ New Role</button>
        </div>
      </div>
      <table className="tbl" aria-labelledby="roles-table-heading">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Description</th>
            <th scope="col">Users</th>
            <th scope="col">Type</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((role) => (
            <tr key={role.id}>
              <td>
                <Link href={`/tenant-admin/roles/${role.id}`} className="lnk">{role.name}</Link>
              </td>
              <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {role.description ?? "—"}
              </td>
              <td>{role.userCount}</td>
              <td>
                {role.isSystemRole ? <span className="pill info">System</span> : <span className="pill mut">Custom</span>}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={4}><div className="empty-state"><div>🔑</div><h4>No roles</h4><p>No roles match this filter.</p></div></td></tr>
          )}
        </tbody>
      </table>

      <NewRoleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); router.refresh(); }}
      />
    </div>
  );
}

function NewRoleDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const nameId = useId();
  const descId = useId();

  if (!open) return null;

  return (
    <ConfirmDialog
      open={open}
      title="Create a new role"
      description={
        <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
          <div>
            <label htmlFor={nameId} style={lbl}>Role name</label>
            <input id={nameId} value={name} onChange={(e) => setName(e.target.value)}
              aria-invalid={nameErr ? true : undefined} placeholder="Finance Reviewer" style={inp} />
            {nameErr ? <p role="alert" style={errSty}>{nameErr}</p> : null}
          </div>
          <div>
            <label htmlFor={descId} style={lbl}>Description <span style={{ fontWeight: 400, color: "#98a2b3" }}>(optional)</span></label>
            <input id={descId} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Can review and approve vouchers" style={inp} />
          </div>
          <p style={{ fontSize: 12, color: "#667085", margin: 0 }}>You can assign permissions after the role is created.</p>
        </div>
      }
      confirmLabel="Create role"
      busy={busy}
      errorMessage={error}
      onConfirm={async () => {
        setNameErr("");
        if (name.trim().length === 0) { setNameErr("Role name is required."); return; }
        setBusy(true);
        setError(undefined);
        try {
          const res = await fetch("/api/proxy/policy/roles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
          });
          if (!res.ok) {
            const text = await res.text();
            let msg = text || `Request failed (${res.status})`;
            try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* */ }
            throw new Error(msg);
          }
          setName(""); setDescription("");
          onCreated();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to create role.");
        } finally {
          setBusy(false);
        }
      }}
      onCancel={() => { if (!busy) { setName(""); setDescription(""); setNameErr(""); setError(undefined); onClose(); } }}
    />
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)" };
const errSty: React.CSSProperties = { color: "#b42318", fontSize: 12, margin: "4px 0 0" };

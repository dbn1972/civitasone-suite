"use client";

import Link from "next/link";
import { StatusPill } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type AdminUser = {
  id: string;
  name?: string | null;
  email: string;
  roles: string[];
  mfaEnabled: boolean;
  status: string;
} & Record<string, unknown>;

export function UsersTable({ users, source = "api" }: { users: AdminUser[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AdminUser[]>(
    "tenantAdmin.users",
    users,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>User directory</h3>
        <div className="seg"><span className="on">All</span><span>Active</span><span>Suspended</span></div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <table className="tbl">
        <thead>
          <tr>
            <th>User</th>
            <th>Department</th>
            <th>Role</th>
            <th>SSO / MFA</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((user) => (
            <tr key={user.id}>
              <td>
                <Link href={`/tenant-admin/users/${user.id}`}>
                  <div className="who">
                    <div className="av">{(user.name ?? user.email).slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className="nm">{user.name ?? "—"}</div>
                      <div className="ml">{user.email}</div>
                    </div>
                  </div>
                </Link>
              </td>
              <td>—</td>
              <td>{user.roles.length > 0 ? user.roles[0] : "—"}</td>
              <td>
                {user.mfaEnabled
                  ? <span className="pill good">MFA on</span>
                  : <span className="pill mut">MFA off</span>}
              </td>
              <td>
                {user.status === "active" ? <span className="pill good">Active</span>
                  : user.status === "suspended" ? <span className="pill bad">Suspended</span>
                  : user.status === "inactive" ? <span className="pill mut">Inactive</span>
                  : <StatusPill status={user.status} label={user.status.replace(/_/g, " ")} />}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5}><div className="empty-state"><div>👥</div><h4>No users yet</h4><p>Users will appear here once added to this tenant.</p></div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import { getProjectMembers } from "../../../../_data/loaders";
import { PageHeader, Card, EmptyState, RefreshErrorState, UserRef } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, PROJECT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { resolveUsers } from "@/lib/directory/resolveUsers";
import { AddMemberForm } from "./AddMemberForm";

export default async function ProjectMembersPage({ params }: { params: { id: string } }) {
  const { data: members, source } = await getProjectMembers(params.id);
  const errored = source === "error";

  // GAP-PROJECTS-DETAIL-MEMBERS-01: resolve member userIds to display names via
  // the shared tenant-scoped user directory (server-side, batched, non-PII).
  // Fail-soft: an unresolved id renders as a short id via UserRef, never a
  // guessed name. The full id stays available in the UserRef title for copy.
  const names = errored ? new Map<string, string>() : await resolveUsers(members.map((m) => m.userId));

  // GAP-PROJECTS-DETAIL-MEMBERS-02: only project managers/officers (project-service
  // PROJ_ROLES) may add/remove members; the server already 403s others. Hide the
  // Add card for everyone else and when the list failed to load — a dangling form
  // over an error is noise and would only 403/again. The server remains the gate.
  const canManage = hasAnyRole(getSessionRoles(), PROJECT_WRITE_ROLES);

  function roleColor(role: string): string {
    if (role === "project_manager") return "var(--good)";
    if (role === "finance_officer") return "var(--warn)";
    return "var(--ink2)";
  }

  function roleBg(role: string): string {
    if (role === "project_manager") return "rgba(5,150,105,0.12)";
    if (role === "finance_officer") return "rgba(245,158,11,0.12)";
    return "rgba(100,116,139,0.10)";
  }

  return (
    <>
      <PageHeader
        title="Project Team"
        subtitle="Members assigned to this project and their roles."
        back={`/projects/${params.id}`}
      />
      {canManage && !errored && (
        <Card title="Add Member" padding>
          <AddMemberForm projectId={params.id} />
        </Card>
      )}
      <Card title="Team Members">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "team members" })} backHref={`/projects/${params.id}`} />
        ) : members.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No team members"
            message="No members have been assigned to this project yet."
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {["Member", "Role", "Added"].map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    {/* GAP-PROJECTS-DETAIL-MEMBERS-01: show the resolved person name
                        (UserRef) instead of a bare UUID. userId stays in the title for
                        copy; an unresolved id falls back to a short id, never a guess. */}
                    <td style={{ fontSize: "0.9rem" }}>
                      <UserRef id={m.userId} name={names.get(m.userId) ?? null} />
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "var(--r)",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: roleBg(m.role),
                          color: roleColor(m.role),
                        }}
                      >
                        {/* GAP-PROJECTS-DETAIL-MEMBERS-04: humanizeStatus title-cases EVERY
                            underscored word ("project_officer" -> "Project Officer"),
                            unlike the old .replace("_"," ") which only fixed the first. */}
                        {humanizeStatus(m.role)}
                      </span>
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {/* GAP-PROJECTS-DETAIL-MEMBERS-05: shared formatter — an invalid
                          createdAt renders "—" instead of "Invalid Date". */}
                      {formatIndianDate(m.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

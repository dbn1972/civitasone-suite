import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProjectMembers } from "../../../../_data/loaders";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { AddMemberForm } from "./AddMemberForm";

export default async function ProjectMembersPage({ params }: { params: { id: string } }) {
  const { data: members, source } = await getProjectMembers(params.id);

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
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Add Member" padding>
        <AddMemberForm projectId={params.id} />
      </Card>
      <Card title="Team Members">
        {members.length === 0 ? (
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
                  {["User ID", "Role", "Added"].map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{m.userId}</td>
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
                        {m.role.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {new Date(m.createdAt).toLocaleDateString("en-IN")}
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

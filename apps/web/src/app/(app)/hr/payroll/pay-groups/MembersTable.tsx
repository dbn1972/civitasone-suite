"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { ChangeGroupButton, EndMembershipButton } from "./MembershipDialogs";
import type { GroupOption, MemberRow } from "./payGroupMembership";

/** Members of one pay group, with per-row Move / End membership for payroll admins. */
export function MembersTable({
  rows, payGroupId, groups, canAdminister, defaultDate,
}: {
  rows: MemberRow[];
  payGroupId: string;
  /** Active groups, for the Move target picker. */
  groups: GroupOption[];
  canAdminister: boolean;
  defaultDate: string;
}) {
  const t = useTranslations("payGroupMembers");
  return (
    <DataTable<MemberRow>
      caption={t("membersTitle")}
      rowKey={(r) => r.assignmentId}
      sortable={false}
      columns={[
        { key: "employeeNo", label: t("colEmployeeNo") },
        { key: "fullName", label: t("colName") },
        { key: "departmentName", label: t("colDepartment"), render: (r) => r.departmentName ?? "—" },
        { key: "effectiveFrom", label: t("colFrom"), render: (r) => formatIndianDate(r.effectiveFrom) },
        {
          key: "effectiveTo",
          label: t("colTo"),
          render: (r) => (r.effectiveTo ? formatIndianDate(r.effectiveTo) : t("openEnded")),
        },
        {
          key: "status",
          label: t("colStatus"),
          cellType: "status",
          statusLabels: { current: t("status.current"), scheduled: t("status.scheduled"), ended: t("status.ended") },
        },
        ...(canAdminister
          ? [
              {
                key: "assignmentId" as const,
                label: t("colActions"),
                render: (r: MemberRow) =>
                  r.status === "ended" ? null : (
                    <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                      <ChangeGroupButton
                        mode="move"
                        currentGroupId={payGroupId}
                        employeeId={r.employeeId}
                        employeeName={r.fullName}
                        groups={groups}
                        defaultDate={defaultDate}
                      />
                      <EndMembershipButton
                        payGroupId={payGroupId}
                        employeeId={r.employeeId}
                        employeeName={r.fullName}
                        defaultDate={defaultDate}
                      />
                    </span>
                  ),
              },
            ]
          : []),
      ]}
      rows={rows}
    />
  );
}

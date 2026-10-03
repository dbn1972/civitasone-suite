"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "../../../../_components/ds";
import { BulkAssignButton, ChangeGroupButton } from "./MembershipDialogs";
import type { GroupOption, UnassignedRow } from "./payGroupMembership";

/** Employees a run for the month would pay but who are in no pay group. */
export function UnassignedTable({
  rows, groups, canAdminister, defaultDate,
}: {
  rows: UnassignedRow[];
  /** Active groups an employee can be assigned to. */
  groups: GroupOption[];
  canAdminister: boolean;
  /** Default effective date for the assign dialogs (first day of the report month). */
  defaultDate: string;
}) {
  const t = useTranslations("payGroupUnassigned");
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {canAdminister && (
        <BulkAssignButton groups={groups} initialEmployeeNos={rows.map((r) => r.employeeNo)} defaultDate={defaultDate} />
      )}
      <DataTable<UnassignedRow>
        caption={t("tableCaption")}
        rowKey={(r) => r.employeeId}
        sortable={false}
        columns={[
          { key: "employeeNo", label: t("colEmployeeNo") },
          { key: "fullName", label: t("colName") },
          { key: "departmentName", label: t("colDepartment"), render: (r) => r.departmentName ?? "—" },
          ...(canAdminister
            ? [
                {
                  key: "employeeId" as const,
                  label: t("colActions"),
                  render: (r: UnassignedRow) => (
                    <ChangeGroupButton
                      mode="assign"
                      employeeId={r.employeeId}
                      employeeName={r.fullName}
                      groups={groups}
                      defaultDate={defaultDate}
                    />
                  ),
                },
              ]
            : []),
        ]}
        rows={rows}
      />
    </div>
  );
}

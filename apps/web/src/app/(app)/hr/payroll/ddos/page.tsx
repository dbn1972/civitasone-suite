import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateDdoForm } from "./CreateDdoForm";
import { ActiveToggle } from "../_components/ActiveToggle";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { departmentLabel, type DdoRecord, type DepartmentOption } from "./ddoData";

type DdoRow = DdoRecord & Record<string, unknown>;

async function getDdos(): Promise<LoaderResult<DdoRow[]>> {
  return fetchJson<unknown, DdoRow[]>("/api/v1/payroll/ddos", [], {
    telemetryKey: "payroll.ddos",
    mapResponse: (p) => (Array.isArray(p) ? (p as DdoRow[]) : null),
  });
}

/** hrms-service department master (GET /v1/hrms/departments). */
async function getDepartments(): Promise<LoaderResult<DepartmentOption[]>> {
  return fetchJson<unknown, DepartmentOption[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "payroll.ddos.departments",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: unknown[] } | null)?.data;
      if (!Array.isArray(arr)) return null;
      return (arr as Array<{ id?: unknown; code?: unknown; name?: unknown }>)
        .filter((d) => typeof d.id === "string" && typeof d.name === "string")
        .map((d) => ({ id: d.id as string, code: typeof d.code === "string" ? d.code : "", name: d.name as string }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export default async function DdosPage({ searchParams }: { searchParams?: { edit?: string } }) {
  const t = await getTranslations("payrollDdos");

  // GAP-PAYROLL-DDOS-04: GET /v1/payroll/ddos is READER_ROLES and the POST
  // is PAYROLL_ROLES (payroll-service routes.ts); hr/layout.tsx admits
  // employee/manager, who would only meet a 403 after filling the form.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="DDO management" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  const [{ data: ddos, source }, deptResult] = await Promise.all([getDdos(), getDepartments()]);
  const errored = source === "error";
  const departmentsAvailable = deptResult.source !== "error";
  const departments = departmentsAvailable ? deptResult.data : [];
  const deptMap = new Map(departments.map((d) => [d.id, d]));

  // GAP-PAYROLL-DDOS-03: show WHICH departments a DDO covers, not a count.
  const rows = ddos.map((d) => {
    const ids = d.departmentIds ?? [];
    return {
      ...d,
      id: d.ddoCode,
      // GAP-PAYROLL-DDOS-03: plain string field (a render fn cannot cross the server boundary).
      status: d.isActive === false ? "inactive" : "active",
      departmentCount: ids.length,
      // ids is this DDO row's own mapping; rows only exist when the DDO list
      // loaded. If the department-NAMES fetch failed, say so with the count
      // rather than printing raw UUIDs as if they were names.
      departmentNames:
        ids.length === 0 // ux-001-ok: per-row mapped-department list is genuinely empty, not a fetch failure (rows only exist when the DDO list loaded)
          ? t("noDepartments")
          : !departmentsAvailable
            ? t("departmentNamesUnavailable", { count: ids.length })
            : ids.map((id) => departmentLabel(id, deptMap)).join(", "),
    };
  });
  const multiDeptDdos = ddos.filter((d) => (d.departmentIds?.length ?? 0) > 1).length;
  const totalDeptMappings = ddos.reduce((s, d) => s + (d.departmentIds?.length ?? 0), 0);
  // GAP-PAYROLL-DDOS-05: no DDOs -> no average ("—"), not a fabricated 0.
  const avgDepts = ddos.length > 0 ? (totalDeptMappings / ddos.length).toFixed(1) : null;

  const editCode = searchParams?.edit?.trim();
  const editing = editCode ? ddos.find((d) => d.ddoCode === editCode) : undefined;

  const columns: { key: (keyof DdoRow & string) | "departmentCount" | "departmentNames" | "status"; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "ddoCode", label: t("colDdoCode") },
    { key: "name", label: t("colName") },
    { key: "departmentNames", label: t("colDepartmentNames") },
    { key: "departmentCount", label: t("colDepartments"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : ddos.length} />
        <StatCard icon="🏢" iconBg="var(--goodbg)" label={t("statMultiDept")} value={errored ? null : multiDeptDdos} />
        <StatCard icon="🔗" iconBg="var(--warnbg)" label={t("statDeptMappings")} value={errored ? null : totalDeptMappings} />
        <StatCard icon="📊" iconBg="var(--goodbg)" label={t("statAvgDepts")} value={errored ? null : avgDepts} />
      </StatGrid>

      {/* The form needs the current mappings to show what a save changes,
          so it is only offered once they have loaded. */}
      {canAdminister && !errored && (
        <CreateDdoForm
          key={editing?.ddoCode ?? "new"}
          existing={ddos.map((d) => ({ ddoCode: d.ddoCode, name: d.name, departmentIds: d.departmentIds ?? [] }))}
          departments={departments}
          departmentsAvailable={departmentsAvailable}
          editing={editing ? { ddoCode: editing.ddoCode, name: editing.name, departmentIds: editing.departmentIds ?? [] } : undefined}
        />
      )}

      {/* GAP-PAYROLL-DDOS-03: deactivate / reactivate. Server-side the DDO is
          refused while it still has active pensioners or runs in progress. */}
      {canAdminister && !errored && editing && (
        <Card title={t("toggleCardTitle", { code: editing.ddoCode })} padding>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
            {editing.isActive === false ? t("toggleInactiveNote") : t("toggleActiveNote")}
          </p>
          <ActiveToggle
            path={`v1/payroll/ddos/${encodeURIComponent(editing.ddoCode)}/status`}
            active={editing.isActive !== false}
            area={t("toggleArea")}
            copy={{
              deactivateBtn: t("toggleDeactivateBtn"),
              reactivateBtn: t("toggleReactivateBtn"),
              deactivateTitle: t("toggleDeactivateTitle"),
              reactivateTitle: t("toggleReactivateTitle"),
              deactivateDescription: t("toggleDeactivateDescription"),
              reactivateDescription: t("toggleReactivateDescription"),
              reasonLabel: t("toggleReasonLabel"),
              deactivatedMessage: t("toggleDeactivated"),
              reactivatedMessage: t("toggleReactivated"),
              conflictMessage: t("toggleConflict"),
              networkError: t("toggleNetworkError"),
            }}
          />
        </Card>
      )}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "ddos" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<DdoRow & { departmentCount: number; departmentNames: string; status: string }>
          columns={columns}
          rows={rows}
          caption={t("tableCaption")}
          {...(canAdminister ? { rowLinkKey: "ddoCode" as const, rowLinkPrefix: "/hr/payroll/ddos?edit=" } : {})}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, RefreshErrorState } from "../../../../_components/ds";
import { getEmployeeById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { EditEmployeeToggle } from "./EditEmployeeToggle";
import { LifecycleTimeline, type LifecycleEvent } from "../../_components/LifecycleTimeline";
import { fetchJson } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type TransferItem = {
  id: string; status: string; toOffice?: string; fromOffice?: string;
  toDeptId?: string; effectiveDate?: string; joinedDate?: string; createdAt?: string;
} & Record<string, unknown>;

type PromotionItem = {
  id: string; status: string; toDesignation?: string; toGrade?: string;
  toDesigId?: string; effectiveDate?: string; createdAt?: string;
} & Record<string, unknown>;

type DeputationItem = {
  id: string; status: string; deputationOrg?: string;
  fromDate?: string; createdAt?: string;
} & Record<string, unknown>;

async function getLifecycleEvents(employeeId: string): Promise<LifecycleEvent[]> {
  const events: LifecycleEvent[] = [];

  // Fetch transfers, promotions, deputations in parallel — best-effort
  const [tRes, pRes, dRes] = await Promise.allSettled([
    fetchJson<unknown, TransferItem[]>(`/api/v1/hrms/lifecycle/transfers?employeeId=${employeeId}`, [], {
      telemetryKey: "hr.emp.lifecycle.transfers",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: TransferItem[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
    fetchJson<unknown, PromotionItem[]>(`/api/v1/hrms/lifecycle/promotions?employeeId=${employeeId}`, [], {
      telemetryKey: "hr.emp.lifecycle.promotions",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: PromotionItem[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
    fetchJson<unknown, DeputationItem[]>(`/api/v1/hrms/deputation?employeeId=${employeeId}`, [], {
      telemetryKey: "hr.emp.lifecycle.deputation",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: DeputationItem[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
  ]);

  if (tRes.status === "fulfilled") {
    for (const t of tRes.value.data) {
      events.push({
        id: `t-${t.id}`,
        type: "transfer",
        date: t.joinedDate ?? t.effectiveDate ?? t.createdAt ?? new Date().toISOString(),
        title: `Transfer → ${t.toOffice ?? "—"}`,
        detail: t.fromOffice ? `From ${t.fromOffice}` : undefined,
        status: t.status,
      });
    }
  }

  if (pRes.status === "fulfilled") {
    for (const p of pRes.value.data) {
      events.push({
        id: `p-${p.id}`,
        type: "promotion",
        date: p.effectiveDate ?? p.createdAt ?? new Date().toISOString(),
        title: `Promoted to ${p.toDesignation ?? p.toGrade ?? "—"}`,
        status: p.status,
      });
    }
  }

  if (dRes.status === "fulfilled") {
    for (const d of dRes.value.data) {
      events.push({
        id: `d-${d.id}`,
        type: "deputation",
        date: d.fromDate ?? d.createdAt ?? new Date().toISOString(),
        title: `Deputed to ${d.deputationOrg ?? "External Organisation"}`,
        status: d.status,
      });
    }
  }

  return events;
}

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { data: employee, source } = await getEmployeeById(params.id);
  const errored = source === "error";
  const t = await getTranslations("employeeDetail");

  if (errored) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} back="/hr/employees" />
        <div className="pad">
          <RefreshErrorState error={toHumanError("load", { area: "employee" })} backHref="/hr/employees" />
        </div>
      </main>
    );
  }

  if (!employee) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} back="/hr/employees" />
        <DataSourceBadge source={source} />
        <Card padding>
          <p className="text-center text-slate-600">{t("notFoundMessage")}</p>
        </Card>
      </main>
    );
  }

  const isActive =
    employee.status?.toLowerCase() === "active" ||
    employee.status?.toLowerCase() === "probation" ||
    employee.status?.toLowerCase() === "confirmed";

  // Build base lifecycle events from known fields
  const baseEvents: LifecycleEvent[] = [];
  if (employee.joiningDate) {
    baseEvents.push({
      id: "join",
      type: "join",
      date: employee.joiningDate as string,
      title: "Joined Organisation",
      detail: employee.department ? `${employee.designation ?? ""} — ${employee.department}` : (employee.designation as string | undefined),
    });
  }
  if (employee.confirmationDate) {
    baseEvents.push({
      id: "confirm",
      type: "confirmation",
      date: employee.confirmationDate as string,
      title: "Service Confirmed",
    });
  }

  // Fetch additional lifecycle events (best-effort)
  const lifecycleEvents = await getLifecycleEvents(params.id);
  const allEvents = [...baseEvents, ...lifecycleEvents];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={employee.name}
        back="/hr/employees"
        actions={<EditEmployeeToggle employee={employee} />}
      />
      <DataSourceBadge source={source} />

      {/* Quick Actions */}
      {isActive && (
        <Card title={t("quickActionsTitle")} padding>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href={`/hr/leave/apply?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionApplyLeave")}
            </Link>
            <Link href={`/hr/payroll/salary-slips?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionSalarySlips")}
            </Link>
            <Link href={`/hr/transfer?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionInitiateTransfer")}
            </Link>
            <Link href={`/hr/promotion?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionInitiatePromotion")}
            </Link>
            <Link href={`/hr/attendance?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionViewAttendance")}
            </Link>
            <Link href={`/hr/service-book?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionServiceBook")}
            </Link>
          </div>
        </Card>
      )}

      <Card title={t("personalInfoTitle")} padding>
        <div className="fields">
          <div className="fld">
            <span className="l">{t("fieldEmployeeId")}</span>
            <span className="v">{employee.employeeId}</span>
          </div>
          <div className="fld">
            <span className="l">{t("fieldDepartment")}</span>
            <span className="v">{employee.department}</span>
          </div>
          <div className="fld">
            <span className="l">{t("fieldDesignation")}</span>
            <span className="v">{employee.designation}</span>
          </div>
          {employee.grade && (
            <div className="fld">
              <span className="l">{t("fieldGrade")}</span>
              <span className="v">{employee.grade}</span>
            </div>
          )}
          <div className="fld">
            <span className="l">{t("fieldJoiningDate")}</span>
            <span className="v">{formatIndianDate(employee.joiningDate as string)}</span>
          </div>
          <div className="fld">
            <span className="l">{t("fieldStatus")}</span>
            <span className="v">
              <StatusPill
                status={employee.status}
                label={employee.status ? employee.status.charAt(0).toUpperCase() + employee.status.slice(1) : "—"}
              />
            </span>
          </div>
          {employee.postingLocation && (
            <div className="fld">
              <span className="l">{t("fieldPostingLocation")}</span>
              <span className="v">{employee.postingLocation}</span>
            </div>
          )}
          {employee.reportingTo && (
            <div className="fld">
              <span className="l">{t("fieldReportsTo")}</span>
              <span className="v">{employee.reportingTo}</span>
            </div>
          )}
          {employee.email && (
            <div className="fld">
              <span className="l">{t("fieldEmail")}</span>
              <span className="v">{employee.email}</span>
            </div>
          )}
          {employee.phone && (
            <div className="fld">
              <span className="l">{t("fieldPhone")}</span>
              <span className="v">{employee.phone}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Lifecycle Timeline */}
      <Card title={t("lifecycleTitle")}>
        <LifecycleTimeline events={allEvents} />
      </Card>
    </main>
  );
}

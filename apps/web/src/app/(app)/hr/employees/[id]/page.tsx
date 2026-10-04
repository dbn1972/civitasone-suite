import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, LoadErrorState } from "../../../../_components/ds";
import { getEmployeeById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { EMPLOYEE_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { isServingStatus, isExitedStatus } from "@/lib/employeeStatus";
import { LifecycleTimeline, type LifecycleEvent } from "../../_components/LifecycleTimeline";
import { fetchJson } from "@/app/_data/apiClient";
import { EmployeePayGroupCard } from "./EmployeePayGroupCard";
import { getEmployeePayGroup } from "../../payroll/pay-groups/payGroupData";
import { INDIAN_STATES_UTS } from "@/lib/india/states";
import { getTranslations } from "next-intl/server";

// GAP-HR-EMPLOYEES-DETAIL-04: GAP-HR-SF-17 (#1658) added batch name
// resolution to GET /v1/hrms/lifecycle/transfers|promotions -- real,
// human-readable names instead of raw ids -- but under toDepartmentName/
// fromDepartmentName/toDesignationName, not the toOffice/fromOffice/
// toDesignation/toGrade field names this page was still reading. Every
// title rendered "Transfer -> --" / "Promoted to --" regardless, even
// after that backend fix landed, because the two sides never agreed on a
// field name. Typed against the *current* real response shape.
/**
 * GAP-HR-EMPLOYEES-NEW-01: the cost centre is stored as an id (a finance
 * master). Show its name -- never the raw id -- and only to roles that
 * administer the record; a viewer who cannot read the finance master (or an
 * id that no longer resolves) simply sees no cost-centre row.
 */
async function getCostCenterName(id: string): Promise<string | null> {
  const r = await fetchJson<unknown, string | null>("/api/v1/finance/cost-centers", null, {
    telemetryKey: "hr.employee.costcentre",
    mapResponse: (p) => {
      const rows = (p as { data?: { id: string; name?: string; code?: string }[] } | null)?.data;
      const row = rows?.find((x) => x.id === id);
      return row ? (row.name ?? row.code ?? null) : null;
    },
  });
  return r.data;
}

type TransferItem = {
  id: string; status: string;
  toDepartmentName?: string; fromDepartmentName?: string;
  toDeptId?: string; effectiveDate?: string; joinedDate?: string; createdAt?: string;
} & Record<string, unknown>;

type PromotionItem = {
  id: string; status: string; toDesignationName?: string;
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
        title: `Transfer → ${t.toDepartmentName ?? "—"}`,
        detail: t.fromDepartmentName ? `From ${t.fromDepartmentName}` : undefined,
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
        title: `Promoted to ${p.toDesignationName ?? "—"}`,
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
  const { data: employee, source, status, errorMessage } = await getEmployeeById(params.id);
  const errored = source === "error";
  const t = await getTranslations("employeeDetail");
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-07: this reuses the edit route's own
  // translated label (`employeeEdit.editButton`) rather than inventing a
  // second copy of the same string under a different key.
  const tEdit = await getTranslations("employeeEdit");

  // GAP-HR-EMPLOYEES-DETAIL-07: a real 404 (nonexistent/deleted id) used to
  // fall into the same branch as a 500/network failure, showing "We
  // couldn't load employee... try again" -- misleading for an id that will
  // never succeed no matter how many times it's retried. Route it to the
  // same honest not-found Card as the "API returned 200 with null" case
  // below instead. 403 still goes through LoadErrorState, which already
  // special-cases it with the backend's own reason (see page.test.tsx).
  if (errored && status === 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} back="/hr/employees" backLabel="Back to Employees" />
        <Card padding>
          <p className="text-center text-slate-600">{t("notFoundMessage")}</p>
        </Card>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        {/* Distinct title from the not-found branch below (was the same
            "Employee Profile" in both, per GAP-HR-EMPLOYEES-DETAIL-07) and
            a consistent back label. */}
        <PageHeader title={t("errorTitle")} back="/hr/employees" backLabel="Back to Employees" />
        <Card padding>
          <LoadErrorState result={{ status, errorMessage }} area="employee" backHref="/hr/employees" />
        </Card>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} back="/hr/employees" backLabel="Back to Employees" />
        <DataSourceBadge source={source} />
        <Card padding>
          <p className="text-center text-slate-600">{t("notFoundMessage")}</p>
        </Card>
      </div>
    );
  }

  // GAP-HR-EMPLOYEES-DETAIL-06: "active" is not a real employee status
  // (employee/status.ts's canonical set is probation/confirmed/on_leave/
  // suspended/deputation/retired/separated/terminated/no_show) -- checking
  // for it here was always false, and deputation (a real, currently-
  // serving status) was missing entirely, so a deputed employee's profile
  // silently lost the whole Quick Actions card with no explanation.
  const serving = isServingStatus(employee.status);
  const exited = isExitedStatus(employee.status);
  const onLeave = employee.status === "on_leave";

  // GAP-HR-EMPLOYEES-DETAIL-02: Edit and the Transfer/Promotion/Separation
  // lifecycle actions are all HR_ROLES-gated on the backend already
  // (employee/routes.ts) -- this just stops the UI from offering a manager
  // (or, before self-scoping is decided, an "employee") a button that can
  // only ever 403. Apply Leave / Attendance / Service Book / Salary Slips
  // stay available to whoever can already open this page -- those targets
  // enforce their own, different scope (e.g. a manager acting for a direct
  // report), unrelated to *administering the employee record itself*.
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));
  const costCenterName = canAdminister && employee.costCenterId ? await getCostCenterName(employee.costCenterId) : null;

  // Pay group (payroll-service, PAYROLL_READER_ROLES): only fetched for roles
  // that may read it, so everyone else never meets a 403 card.
  const payGroupResult = roles.some((r) => PAYROLL_READER_ROLES.includes(r)) ? await getEmployeePayGroup(params.id) : null;

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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={employee.name}
        back="/hr/employees" backLabel="Back to Employees"
        // GAP-HR-EMPLOYEES-DETAIL-EDIT-07: this used to render the whole
        // EditEmployeeForm card inline, inside PageHeader's `actions` slot --
        // which sits in a flex row right next to the page title (ph-act,
        // PageHeader.tsx), not below it. A plain Link to the already-
        // role-gated /edit route (edit/page.tsx mirrors this exact
        // EMPLOYEE_ADMIN_ROLES check server-side) is the gap's own
        // "simplest" fix option and removes the duplicate inline mount of
        // the form entirely.
        actions={canAdminister ? (
          <Link href={`/hr/employees/${params.id}/edit`} className="btn ghost" style={{ minHeight: 44 }}>
            {tEdit("editButton")}
          </Link>
        ) : undefined}
      />
      <DataSourceBadge source={source} />

      {/* Quick Actions */}
      {(serving || onLeave) && (
        <Card title={t("quickActionsTitle")} padding>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href={`/hr/leave/apply?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionApplyLeave")}
            </Link>
            <Link href={`/hr/payroll/salary-slips?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionSalarySlips")}
            </Link>
            <Link href={`/hr/attendance?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionViewAttendance")}
            </Link>
            <Link href={`/hr/service-book?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              {t("actionServiceBook")}
            </Link>
            {/* GAP-HR-EMPLOYEES-DETAIL-02: Transfer/Promotion initiation
                administers the employee record (backend HR_ROLES-gated) --
                a manager viewing their own direct report's profile should
                not see a button that can only 403. Also withheld while
                on_leave: an HR-initiated lifecycle change for someone
                currently away is unusual enough to route through the
                dedicated /hr/transfer, /hr/promotion pages deliberately,
                not this quick-actions row. */}
            {canAdminister && serving && (
              <>
                <Link href={`/hr/transfer?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
                  {t("actionInitiateTransfer")}
                </Link>
                <Link href={`/hr/promotion?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
                  {t("actionInitiatePromotion")}
                </Link>
              </>
            )}
          </div>
        </Card>
      )}

      {/* GAP-HR-EMPLOYEES-DETAIL-03: Initiate Separation is the most
          destructive lifecycle action here -- it used to sit in the same
          button row as "Apply Leave", styled identically, with no role
          gate on this page at all (separate/routes.ts is HR_ROLES-gated
          server-side, but has no guard against re-separating an already-
          exited employee, so `serving` here -- excluding on_leave too,
          unlike the row above -- is the only thing standing between a
          manager and that gap until the backend adds one). Visually and
          semantically separated into its own "HR only" group. */}
      {canAdminister && serving && (
        <Card title={t("lifecycleActionsTitle")} padding>
          <Link
            href={`/hr/retirement?empId=${params.id}`}
            className="btn ghost"
            style={{ fontSize: 13, color: "var(--bad, #b91c1c)", borderColor: "var(--bad, #b91c1c)" }}
          >
            {t("actionInitiateSeparation")}
          </Link>
        </Card>
      )}

      {!serving && !onLeave && (
        <Card padding>
          <p style={{ margin: 0, color: "var(--mut, #64748b)", fontSize: 13 }}>
            {exited ? t("actionsUnavailableExited") : t("actionsUnavailableOther", { status: employee.status })}
          </p>
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
              {/* GAP-HR-EMPLOYEES-DETAIL-06: this custom label bypassed
                  StatusPill's own humanizeStatus fallback, so e.g. the raw
                  "on_leave" rendered as "On_leave" (visible underscore,
                  wrong casing) instead of "On leave". StatusPill's
                  STATUS_MAP already has real variants for every canonical
                  employee status (probation/confirmed/deputation/on_leave/
                  suspended/separated/terminated/retired/no_show) -- no
                  label override needed at all. */}
              <StatusPill status={employee.status} />
            </span>
          </div>
          {employee.postingLocation && (
            <div className="fld">
              <span className="l">{t("fieldPostingLocation")}</span>
              <span className="v">{employee.postingLocation}</span>
            </div>
          )}
          {/* GAP-HR-EMPLOYEES-NEW-01: profile fields the Add Employee wizard
              collects (persisted since migration 0178). */}
          {employee.serviceGrade && (
            <div className="fld">
              <span className="l">{t("fieldServiceGrade")}</span>
              <span className="v">{employee.serviceGrade}</span>
            </div>
          )}
          {employee.workStateCode && (
            <div className="fld">
              <span className="l">{t("fieldWorkState")}</span>
              <span className="v">{INDIAN_STATES_UTS.find((s) => s.code === employee.workStateCode)?.name ?? employee.workStateCode}</span>
            </div>
          )}
          {employee.shift && (
            <div className="fld">
              <span className="l">{t("fieldShift")}</span>
              <span className="v">{t(`shift_${employee.shift}` as never)}</span>
            </div>
          )}
          {employee.maritalStatus && (
            <div className="fld">
              <span className="l">{t("fieldMaritalStatus")}</span>
              <span className="v">{t(`marital_${employee.maritalStatus}` as never)}</span>
            </div>
          )}
          {employee.bloodGroup && (
            <div className="fld">
              <span className="l">{t("fieldBloodGroup")}</span>
              <span className="v">{employee.bloodGroup}</span>
            </div>
          )}
          {costCenterName && (
            <div className="fld">
              <span className="l">{t("fieldCostCenter")}</span>
              <span className="v">{costCenterName}</span>
            </div>
          )}
          {employee.reportingTo && (
            <div className="fld">
              <span className="l">{t("fieldReportsTo")}</span>
              <span className="v">
                {/* GAP-HR-EMPLOYEES-DETAIL-05: reportingTo was plain text --
                    the manager's name with no way to actually get to their
                    profile. managerId (the real FK) is already in the
                    EmployeeDetail response (queries.ts), just never used
                    here. */}
                {employee.managerId ? (
                  <Link href={`/hr/employees/${employee.managerId}`}>{employee.reportingTo}</Link>
                ) : (
                  employee.reportingTo
                )}
              </span>
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

      {/* GAP-HR-EMPLOYEES-DETAIL-05: PAN/bank account/IFSC are already
          returned by GET /v1/hrms/employees/:id, already masked server-side
          (queries.ts's maskValue -- this API never sends the unmasked
          value to begin with, so there is no reveal control here, ever) --
          they just weren't shown anywhere on this page. Admin-only: an
          employee's own bank details are not something a manager viewing
          a direct report needs to see. */}
      {canAdminister && (employee.pan || employee.bankAccountNo || employee.bankIfsc) && (
        <Card title={t("statutoryBankTitle")} padding>
          <div className="fields">
            {employee.pan && (
              <div className="fld">
                <span className="l">{t("fieldPan")}</span>
                <span className="v" style={{ fontFamily: "monospace" }} aria-label={t("maskedAriaLabel")}>{employee.pan}</span>
              </div>
            )}
            {employee.bankAccountNo && (
              <div className="fld">
                <span className="l">{t("fieldBankAccount")}</span>
                <span className="v" style={{ fontFamily: "monospace" }} aria-label={t("maskedAriaLabel")}>{employee.bankAccountNo}</span>
              </div>
            )}
            {employee.bankIfsc && (
              <div className="fld">
                <span className="l">{t("fieldBankIfsc")}</span>
                <span className="v" style={{ fontFamily: "monospace" }} aria-label={t("maskedAriaLabel")}>{employee.bankIfsc}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {payGroupResult && <EmployeePayGroupCard result={payGroupResult} />}

      {/* Lifecycle Timeline */}
      <Card title={t("lifecycleTitle")}>
        <LifecycleTimeline events={allEvents} />
      </Card>
    </div>
  );
}

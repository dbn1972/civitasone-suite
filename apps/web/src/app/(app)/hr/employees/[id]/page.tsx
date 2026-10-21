import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, LoadErrorState, Masked } from "../../../../_components/ds";
import { getEmployeeById } from "../../../../_data/loaders";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { EMPLOYEE_ADMIN_ROLES, EMPLOYEE_PII_REVEAL_ROLES, EMPLOYEE_PHONE_REVEAL_ROLES } from "@/lib/auth/workRoles";
import { isServingStatus, isExitedStatus, employeeStatusVariant } from "@/lib/employeeStatus";
import { LifecycleTimeline, type LifecycleEvent } from "../../_components/LifecycleTimeline";
import { fetchJson } from "@/app/_data/apiClient";
import { EmployeePayGroupCard } from "./EmployeePayGroupCard";
import { getEmployeePayGroup } from "../../payroll/pay-groups/payGroupData";
import { INDIAN_STATES_UTS } from "@/lib/india/states";
import { getEmployeeScannedDocuments } from "./scannedDocumentsData";
import { ScannedDocumentsSection } from "./ScannedDocumentsSection";
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
  id: string; status: string; employeeId?: string;
  toDepartmentName?: string; fromDepartmentName?: string;
  toDeptId?: string; effectiveDate?: string; joinedDate?: string; createdAt?: string;
} & Record<string, unknown>;

type PromotionItem = {
  id: string; status: string; employeeId?: string; toDesignationName?: string;
  toDesigId?: string; effectiveDate?: string; createdAt?: string;
} & Record<string, unknown>;

type DeputationItem = {
  id: string; status: string; employeeId?: string; deputationOrg?: string;
  fromDate?: string; createdAt?: string;
} & Record<string, unknown>;

/**
 * GAP-HR-EMPLOYEES-DETAIL-01: `unavailable` is true when ANY of the three
 * lifecycle reads failed (rejected, or resolved with source "error"). An
 * empty list from a failed read must never be shown as "no lifecycle events
 * recorded" -- the profile would then claim a clean service history it could
 * not actually verify.
 */
type LifecycleResult = { events: LifecycleEvent[]; unavailable: boolean };

async function getLifecycleEvents(employeeId: string): Promise<LifecycleResult> {
  const events: LifecycleEvent[] = [];
  const eid = encodeURIComponent(employeeId);

  // Defence in depth for GAP-HR-EMPLOYEES-DETAIL-01: the backend scopes these
  // lists by ?employeeId=, but a row that names a DIFFERENT employee (an older
  // backend that ignores the filter and returns the whole tenant) must never
  // be rendered on this profile -- it would disclose a colleague's posting.
  const forThisEmployee = <T extends { employeeId?: string }>(rows: T[]): T[] =>
    rows.filter((r) => r.employeeId === undefined || r.employeeId === null || r.employeeId === employeeId);

  // Fetch transfers, promotions, deputations in parallel — best-effort
  const [tRes, pRes, dRes] = await Promise.allSettled([
    fetchJson<unknown, TransferItem[]>(`/api/v1/hrms/lifecycle/transfers?employeeId=${eid}`, [], {
      telemetryKey: "hr.emp.lifecycle.transfers",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: TransferItem[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
    fetchJson<unknown, PromotionItem[]>(`/api/v1/hrms/lifecycle/promotions?employeeId=${eid}`, [], {
      telemetryKey: "hr.emp.lifecycle.promotions",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: PromotionItem[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
    fetchJson<unknown, DeputationItem[]>(`/api/v1/hrms/deputation?employeeId=${eid}`, [], {
      telemetryKey: "hr.emp.lifecycle.deputation",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: DeputationItem[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
  ]);

  const unavailable = [tRes, pRes, dRes].some((r) => r.status === "rejected" || r.value.source === "error");

  if (tRes.status === "fulfilled") {
    for (const t of forThisEmployee(tRes.value.data)) {
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
    for (const p of forThisEmployee(pRes.value.data)) {
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
    for (const d of forThisEmployee(dRes.value.data)) {
      events.push({
        id: `d-${d.id}`,
        type: "deputation",
        date: d.fromDate ?? d.createdAt ?? new Date().toISOString(),
        title: `Deputed to ${d.deputationOrg ?? "External Organisation"}`,
        status: d.status,
      });
    }
  }

  return { events, unavailable };
}

export default async function EmployeeDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-06: the edit form sends the user here with
  // ?updated=1 once a save was accepted (202). That one navigation reads the
  // record fresh (skipping the 60 s data cache -- the no-store is scoped to
  // post-edit arrivals only) and says the change may still be settling,
  // because the write is applied asynchronously.
  const justUpdated = searchParams?.updated === "1";
  const { data: employee, source, status, errorMessage } = justUpdated
    ? await getEmployeeById(params.id, { fresh: true })
    : await getEmployeeById(params.id);
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
      <div className="page-main wrap">
        <PageHeader title={t("notFoundTitle")} back="/hr/employees" backLabel="Back to Employees" />
        <Card padding>
          <p className="text-center text-slate-600">{t("notFoundMessage")}</p>
        </Card>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="page-main wrap">
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
      <div className="page-main wrap">
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
  // W1 SF-05a: values arrive server-masked; a permitted role gets the audited reveal (reason + audit row).
  const canRevealPii = roles.some((r) => EMPLOYEE_PII_REVEAL_ROLES.includes(r));
  const canRevealPhone = roles.some((r) => EMPLOYEE_PHONE_REVEAL_ROLES.includes(r));
  const revealFor = (field: string, label: string, canReveal: boolean) => ({
    canReveal, resourceType: "employee" as const, resourceId: params.id, field, label, revealPath: "v1/hrms/pii/reveal",
  });
  const costCenterName = canAdminister && employee.costCenterId ? await getCostCenterName(employee.costCenterId) : null;
  // GAP-ADMIN-BULK-SCAN-02: scanned records on the personnel file (hrms-service gates the read to these same HR roles).
  const scannedDocs = canAdminister ? await getEmployeeScannedDocuments(params.id) : null;

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

  // Fetch additional lifecycle events (best-effort). The transfer / promotion /
  // deputation lists are HR-staff-only on the backend (hrms-service
  // lifecycle HR_ROLES), so only those roles ask: everyone else would just
  // collect a 403 and a permanent, misleading "history unavailable".
  const lifecycle: LifecycleResult = canAdminister ? await getLifecycleEvents(params.id) : { events: [], unavailable: false };
  const allEvents = [...baseEvents, ...lifecycle.events];

  return (
    <div className="page-main wrap">
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

      {justUpdated && (
        <div role="status" className="card" style={{ padding: "10px 14px", marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>{t("updatedBanner")}</span>
          <Link href={`/hr/employees/${params.id}`} className="btn ghost sm">{t("updatedBannerDismiss")}</Link>
        </div>
      )}

      {/* Quick Actions */}
      {(serving || onLeave) && (
        <Card title={t("quickActionsTitle")} padding>
          {/* GAP-HR-EMPLOYEES-DETAIL-06: someone on leave keeps the self-service
              links below but not the HR lifecycle actions -- say so instead of
              leaving an unexplained gap where Transfer / Promotion would be. */}
          {onLeave && (
            <p role="note" style={{ margin: "0 0 10px", color: "var(--mut)", fontSize: 13 }}>
              {t("actionsLimitedOnLeave")}
            </p>
          )}
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
            style={{ fontSize: 13, color: "var(--bad)", borderColor: "var(--bad)" }}
          >
            {t("actionInitiateSeparation")}
          </Link>
        </Card>
      )}

      {!serving && !onLeave && (
        <Card padding>
          <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>
            {exited ? t("actionsUnavailableExited") : t("actionsUnavailableOther", { status: humanizeStatus(employee.status).toLowerCase() })}
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
              <StatusPill status={employee.status} variant={employeeStatusVariant(employee.status)} />
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
              <span className="v">
                <Masked kind="phone" value={employee.phone} ariaLabel={t("maskedAriaLabel")}
                  onReveal={revealFor("phone", t("fieldPhone"), canRevealPhone)} />
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* GAP-HR-EMPLOYEES-DETAIL-05: PAN/bank account/IFSC are returned by
          GET /v1/hrms/employees/:id already masked server-side (queries.ts
          maskValue). W1 SF-05a: hr_admin / super_admin get an audited reveal
          (reason required, audit row written before the value is returned --
          POST /v1/hrms/pii/reveal); everyone else only ever sees the masked
          value. Admin-only card: an employee's own bank details are not
          something a manager viewing a direct report needs to see. */}
      {canAdminister && (employee.pan || employee.bankAccountNo || employee.bankIfsc) && (
        <Card title={t("statutoryBankTitle")} padding>
          <div className="fields">
            {employee.pan && (
              <div className="fld">
                <span className="l">{t("fieldPan")}</span>
                <span className="v">
                  <Masked kind="pan" value={employee.pan} ariaLabel={t("maskedAriaLabel")}
                    onReveal={revealFor("pan", t("fieldPan"), canRevealPii)} />
                </span>
              </div>
            )}
            {employee.bankAccountNo && (
              <div className="fld">
                <span className="l">{t("fieldBankAccount")}</span>
                <span className="v">
                  <Masked kind="account" value={employee.bankAccountNo} ariaLabel={t("maskedAriaLabel")}
                    onReveal={revealFor("bankAccountNo", t("fieldBankAccount"), canRevealPii)} />
                </span>
              </div>
            )}
            {employee.bankIfsc && (
              <div className="fld">
                <span className="l">{t("fieldBankIfsc")}</span>
                <span className="v">
                  {/* IFSC is a public bank-branch code, not PII: shown in full (owner decision 3). */}
                  {employee.bankIfsc}
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {payGroupResult && <EmployeePayGroupCard result={payGroupResult} />}

      {scannedDocs && <ScannedDocumentsSection result={scannedDocs} backHref="/hr/employees" />}

      {/* Lifecycle Timeline */}
      <Card title={t("lifecycleTitle")}>
        {/* GAP-HR-EMPLOYEES-DETAIL-01: a failed transfers / promotions /
            deputation read is an explicit "unavailable" note above whatever did
            load -- never silently the same as "nothing recorded". */}
        {lifecycle.unavailable && (
          <p role="alert" style={{ margin: 0, padding: "12px 16px", color: "var(--bad)", fontSize: 13 }}>
            {t("lifecycleUnavailable")}
          </p>
        )}
        <LifecycleTimeline events={allEvents} />
      </Card>
    </div>
  );
}

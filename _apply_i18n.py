#!/usr/bin/env python3
"""Batch-apply i18n to remaining HR pages that have namespaces in en.json but
still use hardcoded strings in the page component."""

import re, os

BASE = os.path.expanduser("~/worktrees/r6-i18n/apps/web/src/app/(app)/hr")

def read(path):
    with open(path) as f:
        return f.read()

def write(path, content):
    with open(path, "w") as f:
        f.write(content)

def ensure_import(src, is_client=False):
    if is_client:
        token = "useTranslations"
        pkg = "next-intl"
    else:
        token = "getTranslations"
        pkg = "next-intl/server"
    if token in src:
        return src
    lines = src.split("\n")
    last_import = -1
    for i, line in enumerate(lines):
        if line.startswith("import "):
            last_import = i
    if last_import >= 0:
        lines.insert(last_import + 1, 'import { ' + token + ' } from "' + pkg + '";')
    return "\n".join(lines)

def apply_replacements(src, replacements, label=""):
    for old, new in replacements:
        if old in src:
            src = src.replace(old, new, 1)
        else:
            print("  WARN [" + label + "]: not found: " + old[:60] + "...")
    return src


# ── 1. disciplinary/page.tsx ──────────────────────────────────────────────────

print("Processing: disciplinary/page.tsx")
p = BASE + "/disciplinary/page.tsx"
src = read(p)
src = ensure_import(src)

# Insert t call
if 'getTranslations("disciplinary")' not in src:
    src = src.replace(
        "export default async function DisciplinaryListPage() {\n",
        "export default async function DisciplinaryListPage() {\n"
        '  const t = await getTranslations("disciplinary");\n'
    )

src = apply_replacements(src, [
    ('title="Disciplinary Cases"', 'title={t("title")}'),
    ('subtitle="All departmental proceedings — major vigilance cases and minor grievances in one view."', 'subtitle={t("subtitle")}'),
    ('label="Total Cases"', 'label={t("statTotal")}'),
    # Be specific with the stat labels that have icons
    ('⛖️" iconBg="#fff1f0" label="Major (Vigilance)"', '⛖️" iconBg="#fff1f0" label={t("statMajor")}'),
    ('\U0001f7e1" iconBg="#fffbe6" label="Minor (Grievance)"', '\U0001f7e1" iconBg="#fffbe6" label={t("statMinor")}'),
    ('label="Active / Open"', 'label={t("statOpen")}'),
    ('title="All Disciplinary Cases"', 'title={t("cardTitle")}'),
    ('{ key: "caseRef", label: "Case Ref" }', '{ key: "caseRef", label: t("colCaseRef") }'),
    ('{ key: "employee", label: "Employee" }', '{ key: "employee", label: t("colEmployee") }'),
    ('{ key: "department", label: "Department" }', '{ key: "department", label: t("colDepartment") }'),
    ('{ key: "type", label: "Proceeding Type" }', '{ key: "type", label: t("colType") }'),
    ('{ key: "charges", label: "Charge / Grievance" }', '{ key: "charges", label: t("colCharge") }'),
    ('{ key: "inquiry_officer", label: "IO / HR Officer" }', '{ key: "inquiry_officer", label: t("colOfficer") }'),
    ('{ key: "filed_date", label: "Filed" }', '{ key: "filed_date", label: t("colFiled") }'),
    ('{ key: "status", label: "Status", cellType: "status" }', '{ key: "status", label: t("colStatus"), cellType: "status" }'),
    ('filterPlaceholder="Filter by employee, department or charge…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No disciplinary cases on record"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="All departmental proceedings under CCS (CCA) Rules appear here — both major vigilance cases (charge memo / inquiry) and minor proceedings."', 'emptyMessage={t("emptyMessage")}'),
    ('>Vigilance Only</Link>', '>{t("vigilanceOnly")}</Link>'),
], "disciplinary")
write(p, src)
print("  Done.")


# ── 2. disciplinary/[id]/page.tsx ────────────────────────────────────────────

print("Processing: disciplinary/[id]/page.tsx")
p = BASE + "/disciplinary/[id]/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("disciplinaryDetail")' not in src:
    src = src.replace(
        "export default async function DisciplinaryCaseDetailPage(",
        "export default async function DisciplinaryCaseDetailPage("
    )
    # Insert after the opening brace of the function
    idx = src.find("export default async function DisciplinaryCaseDetailPage(")
    brace = src.find("{", idx)
    nl = src.find("\n", brace)
    src = src[:nl+1] + '  const t = await getTranslations("disciplinaryDetail");\n' + src[nl+1:]

src = apply_replacements(src, [
    ('<PageHeader title="Disciplinary Case" back="/hr/disciplinary" backLabel="Back to Disciplinary" />',
     '<PageHeader title={t("notFoundTitle")} back="/hr/disciplinary" backLabel="Back to Disciplinary" />'),
    ('<EmptyState icon="\U0001f4c1" title="Case not found" message="This disciplinary case may have been removed or the ID is invalid." />',
     '<EmptyState icon="\U0001f4c1" title={t("notFoundEmptyTitle")} message={t("notFoundEmptyMessage")} />'),
    ('title={`Disciplinary case ${caseLabel}`}', 'title={t("title", { caseLabel })}'),
    ('label="Status" value={status.replace(/_/g, " ")}', 'label={t("statStatus")} value={status.replace(/_/g, " ")}'),
    ('label="Proceeding" value={proceedingType}', 'label={t("statProceeding")} value={proceedingType}'),
    ('label="Finding" value={finding}', 'label={t("statFinding")} value={finding}'),
    ('label="Penalty" value={penaltyType}', 'label={t("statPenalty")} value={penaltyType}'),
    ('<Card title="Case details" padding>', '<Card title={t("cardTitle")} padding>'),
    ('"label">Case No<', '"label">{t("fieldCaseNo")}<'),
    ('"label">Proceeding Type<', '"label">{t("fieldProceedingType")}<'),
    ('"label">Finding<', '"label">{t("fieldFinding")}<'),
    ('"label">Penalty<', '"label">{t("fieldPenalty")}<'),
    ('"label">Status<', '"label">{t("fieldStatus")}<'),
    ('"label">Allegation<', '"label">{t("fieldAllegation")}<'),
], "disciplinaryDetail")
write(p, src)
print("  Done.")


# ── 3. goals/page.tsx ─────────────────────────────────────────────────────────

print("Processing: goals/page.tsx")
p = BASE + "/goals/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("goals")' not in src:
    src = src.replace(
        "export default async function GoalsPage() {\n",
        "export default async function GoalsPage() {\n"
        '  const t = await getTranslations("goals");\n'
    )

src = apply_replacements(src, [
    ('title="Goals & Development"', 'title={t("title")}'),
    ('subtitle="Performance goals, OKRs, and development plans for the current appraisal cycle."', 'subtitle={t("subtitle")}'),
    ('label="Total Goals"', 'label={t("statTotal")}'),
    ('label="On Track"', 'label={t("statOnTrack")}'),
    ('label="At Risk / Behind"', 'label={t("statAtRisk")}'),
    ('label="Completed"', 'label={t("statCompleted")}'),
    ('title="Goal Achievement by Category"', 'title={t("achievementCardTitle")}'),
    ('title="My Goals"', 'title={t("goalsCardTitle")}'),
    ('title="Development Plan — Next 12 Months"', 'title={t("devPlanCardTitle")}'),
    ('>No goals set<', '>{t("emptyTitle")}<'),
    ('Goals are assigned during the appraisal cycle. Create an appraisal to assign objectives.\n', '{t("emptyMessage")}\n'),
], "goals")
write(p, src)
print("  Done.")


# ── 4. skills/page.tsx ────────────────────────────────────────────────────────

print("Processing: skills/page.tsx")
p = BASE + "/skills/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("skills")' not in src:
    src = src.replace(
        "export default async function SkillsPage() {\n",
        "export default async function SkillsPage() {\n"
        '  const t = await getTranslations("skills");\n'
    )

src = apply_replacements(src, [
    ('title="Skill Matrix"', 'title={t("title")}'),
    ('subtitle="Employee competency mapping, proficiency levels, and skill gap identification."', 'subtitle={t("subtitle")}'),
    ('label="Skill Records"', 'label={t("statTotal")}'),
    ('label="Employees Mapped"', 'label={t("statEmployees")}'),
    ('label="Expert / Advanced"', 'label={t("statExpert")}'),
    ('label="Beginner / Basic"', 'label={t("statBeginner")}'),
    ('title="Competency Grid"', 'title={t("cardTitle")}'),
    ('>No skill assessments recorded<', '>{t("emptyTitle")}<'),
    ('Skills appear after formal assessments during onboarding or training completions.\n', '{t("emptyMessage")}\n'),
], "skills")
write(p, src)
print("  Done.")


# ── 5. retirement/page.tsx ────────────────────────────────────────────────────

print("Processing: retirement/page.tsx")
p = BASE + "/retirement/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("retirement")' not in src:
    src = src.replace(
        "export default async function RetirementPage() {\n",
        "export default async function RetirementPage() {\n"
        '  const t = await getTranslations("retirement");\n'
    )

# Move COLUMNS inside function
old_columns = '''const COLUMNS: { key: keyof RetirementRow & string; label: string; cellType?: "status" }[] = [
  { key: "employee",          label: "Employee" },
  { key: "department",        label: "Department" },
  { key: "designation",       label: "Designation" },
  { key: "superannuationDate",label: "Retirement Date" },
  { key: "separationType",    label: "Type" },
  { key: "status",            label: "Status", cellType: "status" },
];'''

new_columns_placeholder = '// COLUMNS moved inside component for i18n'

if old_columns in src:
    src = src.replace(old_columns, new_columns_placeholder)
    # Insert columns after t call
    t_call = '  const t = await getTranslations("retirement");\n'
    columns_inside = t_call + '''  const COLUMNS: { key: keyof RetirementRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",          label: t("colEmployee") },
    { key: "department",        label: t("colDepartment") },
    { key: "designation",       label: t("colDesignation") },
    { key: "superannuationDate",label: t("colRetirementDate") },
    { key: "separationType",    label: t("colType") },
    { key: "status",            label: t("colStatus"), cellType: "status" },
  ];
'''
    src = src.replace(t_call, columns_inside)

src = apply_replacements(src, [
    ('title="Retirement & Separation"', 'title={t("title")}'),
    ('subtitle="Upcoming retirements within 6 months, processing wizard, and full separation register."', 'subtitle={t("subtitle")}'),
    ('label="Total"', 'label={t("statTotal")}'),
    ('label="Next 6 Months"', 'label={t("statUpcoming")}'),
    ('label="Processed"', 'label={t("statProcessed")}'),
    ('label="VRS"', 'label={t("statVrs")}'),
    ('title="Full Separation Register"', 'title={t("cardTitle")}'),
    ('filterPlaceholder="Filter by employee, department or date…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No retirement or separation records"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="Superannuation, VRS, and resignation records appear here."', 'emptyMessage={t("emptyMessage")}'),
], "retirement")
write(p, src)
print("  Done.")


# ── 6. work-summary/page.tsx ─────────────────────────────────────────────────

print("Processing: work-summary/page.tsx")
p = BASE + "/work-summary/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("workSummary")' not in src:
    src = src.replace(
        "export default async function WorkSummaryPage() {\n",
        "export default async function WorkSummaryPage() {\n"
        '  const t = await getTranslations("workSummary");\n'
    )

src = apply_replacements(src, [
    ('title="Work Summaries"', 'title={t("title")}'),
    ('subtitle="Annual appraisal period work summaries, task completions, and supervisor ratings."', 'subtitle={t("subtitle")}'),
    ('label="Total Records"', 'label={t("statTotal")}'),
    ('label="Employees"', 'label={t("statEmployees")}'),
    ('label="Reviewed"', 'label={t("statReviewed")}'),
    ('label="Pending Review"', 'label={t("statPending")}'),
    ('{ key: "employee", label: "Employee" }', '{ key: "employee", label: t("colEmployee") }'),
    ('{ key: "department", label: "Department" }', '{ key: "department", label: t("colDepartment") }'),
    ('{ key: "period", label: "Period" }', '{ key: "period", label: t("colPeriod") }'),
    ('{ key: "periodType", label: "Type" }', '{ key: "periodType", label: t("colType") }'),
    ('{ key: "tasks", label: "Tasks" }', '{ key: "tasks", label: t("colTasks") }'),
    ('{ key: "rating", label: "Rating" }', '{ key: "rating", label: t("colRating") }'),
    ('{ key: "status", label: "Status", cellType: "status" }', '{ key: "status", label: t("colStatus"), cellType: "status" }'),
    ('title="Work Summary Records"', 'title={t("cardTitle")}'),
    ('filterPlaceholder="Filter by employee, period or status…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No work summaries yet"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="Work summaries are derived from APAR appraisal records. Each annual appraisal cycle generates a summary of tasks completed and supervisor ratings."', 'emptyMessage={t("emptyMessage")}'),
], "workSummary")
write(p, src)
print("  Done.")


# ── 7. overtime/page.tsx ──────────────────────────────────────────────────────

print("Processing: overtime/page.tsx")
p = BASE + "/overtime/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("overtime")' not in src:
    src = src.replace(
        "export default async function OvertimePage() {\n",
        "export default async function OvertimePage() {\n"
        '  const t = await getTranslations("overtime");\n'
    )

# Move COLUMNS inside function
old_ot_columns = '''const COLUMNS: { key: keyof OTRequest & string; label: string; cellType?: "status" }[] = [
  { key: "employeeId",     label: "Employee" },
  { key: "requestDate",    label: "Date" },
  { key: "hoursRequested", label: "Hours" },
  { key: "reason",         label: "Reason" },
  { key: "status",         label: "Status", cellType: "status" },
];'''

if old_ot_columns in src:
    src = src.replace(old_ot_columns, '// COLUMNS moved inside component for i18n')
    t_call = '  const t = await getTranslations("overtime");\n'
    cols_inside = t_call + '''  const COLUMNS: { key: keyof OTRequest & string; label: string; cellType?: "status" }[] = [
    { key: "employeeId",     label: t("colEmployee") },
    { key: "requestDate",    label: t("colDate") },
    { key: "hoursRequested", label: t("colHours") },
    { key: "reason",         label: t("colReason") },
    { key: "status",         label: t("colStatus"), cellType: "status" },
  ];
'''
    src = src.replace(t_call, cols_inside)

src = apply_replacements(src, [
    ('title="Overtime Requests"', 'title={t("title")}'),
    ('subtitle="Review and track employee overtime requests — linked to payroll disbursement."', 'subtitle={t("subtitle")}'),
    ('label="Total Requests"', 'label={t("statTotal")}'),
    ('label="Pending Approval"', 'label={t("statPending")}'),
    ('label="Approved"', 'label={t("statApproved")}'),
    ('label="Total Hours"', 'label={t("statHours")}'),
    ('title="All Overtime Requests"', 'title={t("cardTitle")}'),
    ('filterPlaceholder="Filter by date, status or employee…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No matching requests"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="Adjust your filter to find the overtime request you need."', 'emptyMessage={t("emptyMessage")}'),
    ('title="No overtime requests yet"', 'title={t("noRequestsTitle")}'),
    ('message="Overtime requests submitted by employees will appear here for approval."', 'message={t("noRequestsMessage")}'),
], "overtime")

# Handle the two "+ New Request" links
src = src.replace('>+ New Request</Link>', '>{t("newRequest")}</Link>')
src = src.replace('>+ New Request</Link>', '>{t("newRequest")}</Link>')

write(p, src)
print("  Done.")


# ── 8. overtime/new/page.tsx (client component) ──────────────────────────────

print("Processing: overtime/new/page.tsx")
p = BASE + "/overtime/new/page.tsx"
src = read(p)
src = ensure_import(src, is_client=True)

if 'useTranslations("overtimeNew")' not in src:
    src = src.replace(
        "  const router = useRouter();\n",
        '  const router = useRouter();\n  const t = useTranslations("overtimeNew");\n'
    )

src = apply_replacements(src, [
    ('title="New Overtime Request"', 'title={t("title")}'),
    ('subtitle="Submit an overtime claim for HR approval."', 'subtitle={t("subtitle")}'),
    ('<Card title="Request Details">', '<Card title={t("cardTitle")}>'),
    ('>Employee ID (UUID)</label>', '>{t("labelEmployee")}</label>'),
    ('placeholder="Employee UUID"', 'placeholder={t("placeholderEmployee")}'),
    ('>Date of Overtime</label>', '>{t("labelDate")}</label>'),
    ('>Hours Requested</label>', '>{t("labelHours")}</label>'),
    ('placeholder="e.g. 2.5"', 'placeholder={t("placeholderHours")}'),
    ('>Reason</label>', '>{t("labelReason")}</label>'),
    ('placeholder="Brief reason for overtime…"', 'placeholder={t("placeholderReason")}'),
    ('setMsg("Overtime request submitted successfully.");', 'setMsg(t("successMessage"));'),
    ('>Cancel</Button>', '>{t("cancel")}</Button>'),
], "overtimeNew")

# Handle the submit button text
src = src.replace(
    '{status === "submitting" ? "Submitting…" : "Submit Request"}',
    '{status === "submitting" ? t("submitting") : t("submitRequest")}'
)

write(p, src)
print("  Done.")


# ── 9. payroll/comparison/page.tsx ────────────────────────────────────────────

print("Processing: payroll/comparison/page.tsx")
p = BASE + "/payroll/comparison/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("payrollComparison")' not in src:
    idx = src.find("export default async function PayrollComparisonPage(")
    brace = src.find("{", idx)
    nl = src.find("\n", brace)
    src = src[:nl+1] + '  const t = await getTranslations("payrollComparison");\n' + src[nl+1:]

src = apply_replacements(src, [
    ('title="Payroll Comparison"', 'title={t("title")}'),
    ('subtitle="Month-on-month comparison of payroll register totals."', 'subtitle={t("subtitle")}'),
    ('title="Select Periods to Compare"', 'title={t("filterCardTitle")}'),
    ('>Compare</Button>', '>{t("compareButton")}</Button>'),
    ('label="Headcount Δ"', 'label={t("statHeadcountDelta")}'),
    ('label="Net Pay Δ"', 'label={t("statNetDelta")}'),
    ('title="Choose two periods to compare"', 'title={t("emptyTitle")}'),
    ('message="Enter both periods above in YYYY-MM format (e.g. 2025-05 and 2025-06) and select Compare."', 'message={t("emptyMessage")}'),
    ('title="No comparison data"', 'title={t("noDataTitle")}'),
    ('message="No payroll register totals were found for one or both of the selected periods."', 'message={t("noDataMessage")}'),
    ('>Metric</th>', '>{t("colMetric")}</th>'),
    ('>Delta</th>', '>{t("colDelta")}</th>'),
    ('>Gross Pay</th>', '>{t("metricGross")}</th>'),
    ('>Net Pay</th>', '>{t("metricNet")}</th>'),
    ('>Headcount</th>', '>{t("metricHeadcount")}</th>'),
], "payrollComparison")

# Fix Period labels
src = src.replace(
    'fontWeight: 600 }}>\n            Period 1 <span',
    'fontWeight: 600 }}>\n            {t("labelPeriod1")} <span'
)
src = src.replace(
    'fontWeight: 600 }}>\n            Period 2 <span',
    'fontWeight: 600 }}>\n            {t("labelPeriod2")} <span'
)

write(p, src)
print("  Done.")


# ── 10. payroll/costing/page.tsx ──────────────────────────────────────────────

print("Processing: payroll/costing/page.tsx")
p = BASE + "/payroll/costing/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("payrollCosting")' not in src:
    idx = src.find("export default async function CostingPage(")
    brace = src.find("{", idx)
    nl = src.find("\n", brace)
    src = src[:nl+1] + '  const t = await getTranslations("payrollCosting");\n' + src[nl+1:]

src = apply_replacements(src, [
    ('title="Cost Allocation"', 'title={t("title")}'),
    ('subtitle="Define cost-center allocation rules and view the monthly costing report."', 'subtitle={t("subtitle")}'),
    ('label="Allocations (this period)"', 'label={t("statAllocations")}'),
    ('label="Cost Centers (this period)"', 'label={t("statCostCenters")}'),
    ('label="Employee Groups (this period)"', 'label={t("statEmpGroups")}'),
    ('<Card title="Costing Rules">', '<Card title={t("rulesCardTitle")}>'),
    ('title="Rules list not yet available"', 'title={t("rulesEmptyTitle")}'),
    ('message="Use the form above to create a cost-center allocation rule; a rules list view is not wired up yet."', 'message={t("rulesEmptyMessage")}'),
    ('<Card title="Costing Report">', '<Card title={t("reportCardTitle")}>'),
    ('title="Choose a period"', 'title={t("choosePeriodTitle")}'),
    ('message="Enter a period (YYYY-MM) above to view the cost allocation report."', 'message={t("choosePeriodMessage")}'),
    ('{ key: "employeeGroup", label: "Employee Group" }', '{ key: "employeeGroup", label: t("colEmployeeGroup") }'),
    ('{ key: "costCenterCode", label: "Cost Center" }', '{ key: "costCenterCode", label: t("colCostCenter") }'),
    ('{ key: "splitPct", label: "Split %", align: "right" }', '{ key: "splitPct", label: t("colSplitPct"), align: "right" }'),
    ('{ key: "allocatedMinor", label: "Allocated Amount", align: "right", cellType: "amount" }', '{ key: "allocatedMinor", label: t("colAllocated"), align: "right", cellType: "amount" }'),
    ('filterPlaceholder="Filter by employee group…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No allocations for this period"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="No active costing rules produced allocations for this period."', 'emptyMessage={t("emptyMessage")}'),
], "payrollCosting")
write(p, src)
print("  Done.")


# ── 11. payroll/ctc/page.tsx ──────────────────────────────────────────────────

print("Processing: payroll/ctc/page.tsx")
p = BASE + "/payroll/ctc/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("payrollCtc")' not in src:
    src = src.replace(
        "export default async function CtcConfigPage() {\n",
        "export default async function CtcConfigPage() {\n"
        '  const t = await getTranslations("payrollCtc");\n'
    )

src = apply_replacements(src, [
    ('title="CTC Configuration"', 'title={t("title")}'),
    ('subtitle="Cost-to-Company component rules used to break a CTC figure into pay components."', 'subtitle={t("subtitle")}'),
    ('label="Configured Components"', 'label={t("statTotal")}'),
    ('label="Employer-Cost"', 'label={t("statEmployerCost")}'),
    ('label="Active Components"', 'label={t("statActive")}'),
    ('label="Percentage-Based"', 'label={t("statPctBased")}'),
    ('title="CTC Component Configuration"', 'title={t("cardTitle")}'),
    ('{ key: "component_code", label: "Code" }', '{ key: "component_code", label: t("colCode") }'),
    ('{ key: "component_name", label: "Component" }', '{ key: "component_name", label: t("colComponent") }'),
    ('{ key: "calcTypeLabel", label: "Calculation" }', '{ key: "calcTypeLabel", label: t("colCalculation") }'),
    ('{ key: "valueDisplay", label: "Value", align: "right" }', '{ key: "valueDisplay", label: t("colValue"), align: "right" }'),
    ('{ key: "employerCostLabel", label: "Employer Cost" }', '{ key: "employerCostLabel", label: t("colEmployerCost") }'),
    ('filterPlaceholder="Filter by code or component…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No CTC configuration found"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="No active payroll_ctc_config rows are configured for this tenant."', 'emptyMessage={t("emptyMessage")}'),
], "payrollCtc")
write(p, src)
print("  Done.")


# ── 12. payroll/reimbursements/page.tsx ───────────────────────────────────────

print("Processing: payroll/reimbursements/page.tsx")
p = BASE + "/payroll/reimbursements/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("payrollReimbursements")' not in src:
    src = src.replace(
        "export default async function ReimbursementsPage() {\n",
        "export default async function ReimbursementsPage() {\n"
        '  const t = await getTranslations("payrollReimbursements");\n'
    )

src = apply_replacements(src, [
    ('title="Reimbursements"', 'title={t("title")}'),
    ('subtitle="Employee expense reimbursement claims (medical, travel, LTA, and more)."', 'subtitle={t("subtitle")}'),
    ('label="Total Claims"', 'label={t("statTotal")}'),
    ('label="Pending"', 'label={t("statPending")}'),
    ('label="Total Claimed"', 'label={t("statClaimed")}'),
    ('label="Approved"', 'label={t("statApproved")}'),
    ('title="Reimbursement Claims"', 'title={t("cardTitle")}'),
    ('{ key: "employee_id", label: "Employee" }', '{ key: "employee_id", label: t("colEmployee") }'),
    ('{ key: "category", label: "Category" }', '{ key: "category", label: t("colCategory") }'),
    ('{ key: "amount_minor", label: "Amount", align: "right", cellType: "amount" }', '{ key: "amount_minor", label: t("colAmount"), align: "right", cellType: "amount" }'),
    ('{ key: "period", label: "Period" }', '{ key: "period", label: t("colPeriod") }'),
    ('{ key: "bill_ref", label: "Bill Ref" }', '{ key: "bill_ref", label: t("colBillRef") }'),
    ('{ key: "status", label: "Status", cellType: "status" }', '{ key: "status", label: t("colStatus"), cellType: "status" }'),
    ('filterPlaceholder="Filter by employee or category…"', 'filterPlaceholder={t("filterPlaceholder")}'),
    ('emptyTitle="No reimbursement claims yet"', 'emptyTitle={t("emptyTitle")}'),
    ('emptyMessage="Create your first claim using the form above."', 'emptyMessage={t("emptyMessage")}'),
], "payrollReimbursements")
write(p, src)
print("  Done.")


# ── 13. payroll/returns/page.tsx ──────────────────────────────────────────────

print("Processing: payroll/returns/page.tsx")
p = BASE + "/payroll/returns/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("payrollReturns")' not in src:
    idx = src.find("export default async function ReturnsPage(")
    brace = src.find("{", idx)
    nl = src.find("\n", brace)
    src = src[:nl+1] + '  const t = await getTranslations("payrollReturns");\n' + src[nl+1:]

src = apply_replacements(src, [
    ('title="Quarterly TDS Returns"', 'title={t("title")}'),
    ('subtitle="Form-24Q (salary) and Form-26Q (non-salary) quarterly e-TDS returns."', 'subtitle={t("subtitle")}'),
    ('<Card title={"Annual TDS Returns Overview — FY " + fy}>', '<Card title={t("annualOverviewTitle", { fy })}>'),
    ('<Card title={"Form-24Q — Salary TDS — FY " + fy + " " + quarter}>', '<Card title={t("form24qTitle", { fy, quarter })}>'),
    ('<Card title={"Form-26Q — Non-Salary TDS — FY " + fy + " " + quarter}>', '<Card title={t("form26qTitle", { fy, quarter })}>'),
    # 24Q stat cards
    ('label="Deductees" value={f24Lookup.data.deducteeCount}', 'label={t("statDeductees")} value={f24Lookup.data.deducteeCount}'),
    ('label="Total TDS Deducted" value={formatMoney(totalTdsDeductedMinor24)}', 'label={t("statTdsDeducted")} value={formatMoney(totalTdsDeductedMinor24)}'),
    ('label="Challan Reconciliation"\n', 'label={t("statReconciliation")}\n'),
    ('value={f24Lookup.data.reconciliation.matched ? "Matched" : "Unreconciled"}', 'value={f24Lookup.data.reconciliation.matched ? t("matched") : t("unreconciled")}'),
    ('label="TDS Deposited" value={formatMoney(totalTdsDepositedMinor24)}', 'label={t("statTdsDeposited")} value={formatMoney(totalTdsDepositedMinor24)}'),
    ('label="Variance" value={formatMoney(varianceMinor24)}', 'label={t("statVariance")} value={formatMoney(varianceMinor24)}'),
    # 24Q columns
    ('{ key: "name", label: "Employee" }', '{ key: "name", label: t("colEmployee") }'),
    ('{ key: "pan", label: "PAN" }', '{ key: "pan", label: t("colPan") }'),
    ('{ key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" }', '{ key: "tdsDeductedMinor", label: t("colTdsDeducted"), align: "right", cellType: "amount" }'),
    ('{ key: "tdsDepositedMinor", label: "TDS Deposited", align: "right", cellType: "amount" }', '{ key: "tdsDepositedMinor", label: t("colTdsDeposited"), align: "right", cellType: "amount" }'),
    ('filterPlaceholder="Filter by employee or PAN…"', 'filterPlaceholder={t("filter24qPlaceholder")}'),
    ('emptyTitle="No deductees this quarter"', 'emptyTitle={t("empty24qTitle")}'),
    ('emptyMessage="No approved/disbursed payroll runs contributed TDS in this quarter yet."', 'emptyMessage={t("empty24qMessage")}'),
    # 26Q columns
    ('{ key: "name", label: "Deductee" }', '{ key: "name", label: t("colDeductee") }'),
    ('{ key: "section", label: "Section" }', '{ key: "section", label: t("colSection") }'),
    ('{ key: "amountPaidMinor", label: "Amount Paid", align: "right", cellType: "amount" }', '{ key: "amountPaidMinor", label: t("colAmountPaid"), align: "right", cellType: "amount" }'),
    ('filterPlaceholder="Filter by name, PAN, or section…"', 'filterPlaceholder={t("filter26qPlaceholder")}'),
    ('emptyTitle="No non-salary deductees this quarter"', 'emptyTitle={t("empty26qTitle")}'),
    # Block/error titles
    ('title={"Form-24Q blocked for FY " + fy + " " + quarter}', 'title={t("form24qBlockedTitle", { fy, quarter })}'),
    ('title={"Could not load Form-24Q for FY " + fy + " " + quarter}', 'title={t("form24qLoadErrorTitle", { fy, quarter })}'),
    ('title={"Could not load Form-26Q for FY " + fy + " " + quarter}', 'title={t("form26qLoadErrorTitle", { fy, quarter })}'),
    ('title="Non-salary TDS not yet populated"', 'title={t("form26qNotPopulated")}'),
    # 26Q stat cards
    ('label="Deductees" value={f26.deducteeCount}', 'label={t("statDeductees")} value={f26.deducteeCount}'),
    ('label="Total TDS Deducted" value={formatMoney(f26.totalTdsDeductedMinor)}', 'label={t("statTdsDeducted")} value={formatMoney(f26.totalTdsDeductedMinor)}'),
    ('value={f26.reconciliation.matched ? "Matched" : "Unreconciled"}', 'value={f26.reconciliation.matched ? t("matched") : t("unreconciled")}'),
    ('label="Amount Paid" value={formatMoney(totalAmountPaidMinor26)}', 'label={t("statAmountPaid")} value={formatMoney(totalAmountPaidMinor26)}'),
], "payrollReturns")

# Handle download links and second PAN/TDS columns
src = src.replace('>Download RPU flat file (.txt)', '>{t("downloadRpu")}')
src = src.replace('>Download RPU flat file (.txt)', '>{t("downloadRpu")}')
# Second PAN col for 26Q
if '{ key: "pan", label: "PAN" }' in src:
    src = src.replace('{ key: "pan", label: "PAN" }', '{ key: "pan", label: t("colPan") }', 1)
# Second TDS deducted col for 26Q
if '{ key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" }' in src:
    src = src.replace('{ key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" }',
                       '{ key: "tdsDeductedMinor", label: t("colTdsDeducted"), align: "right", cellType: "amount" }', 1)
# Second challan reconciliation label
if 'label="Challan Reconciliation"' in src:
    src = src.replace('label="Challan Reconciliation"', 'label={t("statReconciliation")}', 1)

write(p, src)
print("  Done.")


# ── 14. payroll/structures/page.tsx ───────────────────────────────────────────

print("Processing: payroll/structures/page.tsx")
p = BASE + "/payroll/structures/page.tsx"
src = read(p)
src = ensure_import(src)

if 'getTranslations("payrollStructures")' not in src:
    src = src.replace(
        "export default async function PayStructuresPage() {\n",
        "export default async function PayStructuresPage() {\n"
        '  const t = await getTranslations("payrollStructures");\n'
    )

src = apply_replacements(src, [
    ('title="Pay Structures"\n        subtitle', 'title={t("title")}\n        subtitle'),
    ('subtitle="Define earning and deduction components that make up an employee\'s pay."', 'subtitle={t("subtitle")}'),
    ('label="Total Structures"', 'label={t("statTotal")}'),
    ('label="Active"', 'label={t("statActive")}'),
    ('label="Default"', 'label={t("statDefault")}'),
    ('label="Components"', 'label={t("statComponents")}'),
    ('title="Salary Structure Cards"', 'title={t("cardsTitle")}'),
    ('title="Component Grid — Earnings, Deductions & Benefits"', 'title={t("componentGridTitle")}'),
    ('title="No pay structures yet"', 'title={t("emptyTitle")}'),
    ('message="Create your first salary structure using the form above."', 'message={t("emptyMessage")}'),
], "payrollStructures")

# Handle the two "Pay Structures" card titles
src = src.replace('<Card title="Pay Structures">', '<Card title={t("structuresCardTitle")}>')
src = src.replace('<Card title="Pay Structures">', '<Card title={t("structuresCardTitle")}>')

write(p, src)
print("  Done.")


print("\n=== All 14 pages processed ===")

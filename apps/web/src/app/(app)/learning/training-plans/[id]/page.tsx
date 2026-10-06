import { notFound } from "next/navigation";
import { PageHeader, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { getTrainingPlanDetail, getCourses, getTrainingPrograms, getDepartments } from "../../_data";

type ItemRow = { id: string; item: string; type: string; targetDate: string; mandatory: string };

export default async function Page({ params }: { params: { id: string } }) {
  const { data: plan, source } = await getTrainingPlanDetail(params.id);

  if (source === "error") {
    return (
      <>
        <PageHeader title="Training Plan" back="/learning/training-plans" />
        <RefreshErrorState error={toHumanError("load", { area: "training plan" })} backHref="/learning/training-plans" />
      </>
    );
  }
  if (!plan) {
    notFound();
  }

  const [{ data: courses }, { data: programs }, { data: departments }] = await Promise.all([
    getCourses(),
    getTrainingPrograms(),
    getDepartments(),
  ]);
  const courseTitle = new Map(courses.map((c) => [c.id, c.title] as const));
  const programTitle = new Map(programs.map((p) => [p.id, p.title] as const));
  const deptName = new Map(departments.map((d) => [d.id, d.name] as const));

  const scopeParts: string[] = [];
  if (plan.departmentId) scopeParts.push(`Dept: ${deptName.get(plan.departmentId) ?? "unknown"}`);
  if (plan.roleCode) scopeParts.push(`Role: ${plan.roleCode}`);
  const scope = scopeParts.length ? scopeParts.join(" · ") : "All staff";

  const rows: ItemRow[] = plan.items.map((it) => {
    const isCourse = Boolean(it.courseId);
    const name = isCourse
      ? courseTitle.get(it.courseId ?? "") ?? "Course (unavailable)"
      : programTitle.get(it.trainingId ?? "") ?? "Programme (unavailable)";
    return {
      id: it.id,
      item: name,
      type: isCourse ? "Course" : "Programme",
      targetDate: it.targetDate ? formatIndianDate(it.targetDate) : "—",
      mandatory: it.mandatory ? "Yes" : "No",
    };
  });

  return (
    <>
      <PageHeader title={plan.title} subtitle={`FY ${fiscalYearLabel(plan.planYear)} · ${scope}`} back="/learning/training-plans" />
      <StatGrid>
        <StatCard icon="📅" iconBg="var(--panel)" label="Year" value={`FY ${fiscalYearLabel(plan.planYear)}`} />
        <StatCard icon="🎯" iconBg="var(--panel)" label="Scope" value={scope} />
        <StatCard icon="📌" iconBg="var(--panel)" label="Status" value={plan.status} />
        <StatCard icon="📚" iconBg="var(--panel)" label="Items" value={plan.items.length} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Plan items</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📋" title="No items yet" message="This plan has no courses or programmes assigned yet." />
        ) : (
          <DataTable<ItemRow>
            columns={[
              { key: "item", label: "Course / Programme" },
              { key: "type", label: "Type", cellType: "status" },
              { key: "targetDate", label: "Target date" },
              { key: "mandatory", label: "Mandatory", cellType: "status" },
            ]}
            rows={rows}
            sortable
            pageSize={20}
          />
        )}
      </div>
    </>
  );
}

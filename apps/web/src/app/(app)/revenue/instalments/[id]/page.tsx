import { notFound } from "next/navigation";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

type ScheduleLine = {
  id: string;
  sequenceNo: number;
  dueDate: string;
  amountMinor: string;
  paidMinor: string;
  status: string | null;
} & Record<string, unknown>;

type PlanDetail = {
  id: string;
  totalMinor: string;
  instalmentCount: number;
  startDate: string;
  status: string;
  schedule: ScheduleLine[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapPlan(payload: unknown): PlanDetail | null {
  const body = isRecord(payload)
    ? isRecord((payload as { data?: unknown }).data)
      ? (payload as { data: Record<string, unknown> }).data
      : payload
    : null;
  if (!body || typeof body.id !== "string") return null;
  const rawSchedule = Array.isArray(body.schedule) ? body.schedule : [];
  const schedule: ScheduleLine[] = [];
  for (const raw of rawSchedule) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    schedule.push({
      id,
      sequenceNo: typeof raw.sequenceNo === "number" ? raw.sequenceNo : Number(raw.sequenceNo ?? 0),
      dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
      amountMinor: String(raw.amountMinor ?? 0),
      paidMinor: String(raw.paidMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : null,
    });
  }
  return {
    id: body.id,
    totalMinor: String(body.totalMinor ?? 0),
    instalmentCount: typeof body.instalmentCount === "number" ? body.instalmentCount : Number(body.instalmentCount ?? 0),
    startDate: typeof body.startDate === "string" ? body.startDate : "",
    status: typeof body.status === "string" ? body.status : "unknown",
    schedule,
  };
}

async function getPlan(id: string): Promise<LoaderResult<PlanDetail | null>> {
  return fetchJson<unknown, PlanDetail | null>(`/api/v1/revenue/instalments/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.instalments.detail",
    mapResponse: mapPlan,
  });
}

export default async function InstalmentPlanDetailPage({ params }: { params: { id: string } }) {
  const { data: plan, source, status } = await getPlan(params.id);

  if (status === 404 || (!plan && source !== "error")) {
    notFound();
  }
  if (!plan || source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Instalment Plan" subtitle="Schedule and status for an instalment plan." back="/revenue/instalments" />
        <Card title="Plan" padding>
          <RefreshErrorState
            error={{
              what: "We couldn't load this instalment plan.",
              next: "Retry in a moment. If it keeps failing, the revenue service may be unavailable.",
              actions: ["retry", "back"],
            }}
            backHref="/revenue/instalments"
            source={{ status, area: "revenue" }}
          />
        </Card>
      </div>
    );
  }

  const scheduleRows = plan.schedule.map((s) => ({ ...s, dueDateDisplay: formatIndianDate(s.dueDate) }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Instalment Plan"
        subtitle="Schedule and status for an instalment plan."
        back="/revenue/instalments"
      />

      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f0ff" label="Total Due" value={formatMoney(plan.totalMinor)} />
        <StatCard icon="📆" iconBg="#e6f7f0" label="Instalments" value={plan.instalmentCount} />
        <StatCard icon="📅" iconBg="#fff2e6" label="Start Date" value={formatIndianDate(plan.startDate)} />
      </StatGrid>

      <Card title="Schedule">
        <DataTable<(typeof scheduleRows)[number]>
          columns={[
            { key: "sequenceNo", label: "#", align: "right" },
            { key: "dueDateDisplay", label: "Due Date" },
            { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
            { key: "paidMinor", label: "Paid", align: "right", cellType: "amount" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={scheduleRows}
          sortable
          pageSize={36}
          emptyIcon="📆"
          emptyTitle="No schedule lines"
          emptyMessage="This plan has no instalment lines yet."
        />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { ShiftCard } from "../_components/ShiftCard";

/**
 * ShiftsListPage — displays and manages shift definitions.
 * GoI context: Standard Govt working hours = 09:00–17:30 Mon–Fri per DoPT O.M.
 */

type ApiShift = {
  id: string;
  name: string;
  startTime?: string;
  endTime?: string;
  breakDuration?: string;
  breakMinutes?: number;
  workingHours?: string;
  workingMinutes?: number;
  applicableTo?: string;
  departments?: string[];
  status: string;
};

type Row = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  workingHours: string;
  applicableTo: string;
  status: string;
} & Record<string, unknown>;

function formatMinutes(minutes: number | undefined): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h} hrs`;
}

function mapShifts(apiItems: ApiShift[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime ?? "—",
    endTime: s.endTime ?? "—",
    breakDuration: s.breakDuration ?? (s.breakMinutes ? `${s.breakMinutes} min` : "—"),
    workingHours: s.workingHours ?? formatMinutes(s.workingMinutes),
    applicableTo: s.applicableTo ?? (s.departments?.join(", ") ?? "—"),
    status: s.status,
  }));
}

async function getShifts(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/shifts", [], {
    telemetryKey: "hr.shifts",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiShift[] })?.data;
      return Array.isArray(arr) ? mapShifts(arr as ApiShift[]) : null;
    },
  });
}

export default async function ShiftsPage() {
  const t = await getTranslations("shifts");
  const { data: items, source } = await getShifts();
  // COMP-004 fix-up (round 3): this page used to silently substitute a
  // hardcoded 4-row GOVT_SHIFTS list whenever the real API call returned
  // zero rows -- whether that meant a genuine fetch failure (source:
  // "error") or a tenant that legitimately has no shifts configured yet
  // (source: "api", []). Both cases rendered identical fake "DoPT-standard"
  // rows as if they were real tenant data, with the StatCards counting them
  // and DataSourceBadge's error message showing on top of fake rows in the
  // error case. Distinguish the two real cases instead -- no fabricated
  // fallback in either.
  const errored = source === "error";

  const active = errored ? 0 : items.filter((i) => i.status === "active").length;
  const departments = errored
    ? 0
    : new Set(
        items.flatMap((i) => i.applicableTo.split(",").map((d) => d.trim())).filter((d) => d && d !== "—"),
      ).size;

  const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: t("colName") },
    { key: "startTime", label: t("colStart") },
    { key: "endTime", label: t("colEnd") },
    { key: "breakDuration", label: t("colBreak") },
    { key: "workingHours", label: t("colWorkingHours") },
    { key: "applicableTo", label: t("colApplicableTo") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={
          <Link href="/hr/shift-requests" className="btn ghost" aria-label={t("changeRequests")}>
            {t("changeRequests")}
          </Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🕐" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalShifts")} value={errored ? "—" : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActive")} value={errored ? "—" : active} />
        <StatCard icon="👥" iconBg="var(--warnbg, #fffbe6)" label={t("statDepartments")} value={errored ? "—" : departments} />
        <StatCard icon="⏰" iconBg="var(--bg, #f5f5f5)" label={t("statStdHours")} value={t("stdHoursValue")} />
      </StatGrid>

      {!errored && items.length > 0 && (
        <section aria-label={t("sectionAriaLabel")} style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {items.slice(0, 6).map((shift) => (
              <ShiftCard key={shift.id} {...shift} />
            ))}
          </div>
        </section>
      )}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "shift definitions" })} backHref="/hr" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🕐"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<Row>
            columns={COLUMNS}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
          />
        )}
      </Card>
    </div>
  );
}

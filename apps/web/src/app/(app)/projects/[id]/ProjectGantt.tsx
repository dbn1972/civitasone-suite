"use client";

import { DataTable } from "../../../_components/ds";
import { GanttChart, type GanttTask } from "../../../_components/GanttChart";
import { formatIndianDate } from "@/lib/formatters";

interface Milestone {
  title: string;
  dueDate: string;
  completedDate?: string | null;
  status: string;
}

interface ProjectGanttProps {
  milestones: Milestone[];
  projectStart: string;
  projectEnd?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  pending: "Pending",
  delayed: "Delayed",
};

type MilestoneRow = {
  title: string;
  start: string;
  dueDate: string;
  status: string;
  progress: number;
} & Record<string, unknown>;

export function ProjectGantt({ milestones, projectStart, projectEnd }: ProjectGanttProps) {
  if (milestones.length === 0) return null;

  // GAP-PROJECTS-DETAIL-04: the bars derive each start from the PREVIOUS
  // milestone's due date assuming list order, so an out-of-order API response
  // drew bars out of sequence. Sort by dueDate first (stable, nulls/invalid
  // last) so the derived start chain and the chart are always chronological.
  // Progress is still a status-derived approximation (the API carries no
  // per-milestone start/progress field today), so the chart is labelled
  // "Approximate timeline".
  const sorted = [...milestones].sort((a, b) => {
    const ta = Date.parse(a.dueDate);
    const tb = Date.parse(b.dueDate);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });

  const tasks: GanttTask[] = sorted.map((m, i) => {
    const start = i === 0 ? projectStart : sorted[i - 1].dueDate;
    const progress = m.status === "completed" ? 100 : m.status === "in_progress" ? 50 : 0;
    return {
      id: `ms-${i}`,
      name: m.title,
      startDate: start,
      endDate: m.dueDate,
      progress,
    };
  });

  const ariaLabel =
    `Milestone timeline Gantt chart (approximate) covering ${formatIndianDate(projectStart)}` +
    `${projectEnd ? ` to ${formatIndianDate(projectEnd)}` : ""}, ` +
    `${sorted.length} milestone${sorted.length === 1 ? "" : "s"}. ` +
    `An equivalent data table follows.`;

  const tableRows: MilestoneRow[] = sorted.map((m, i) => {
    const start = i === 0 ? projectStart : sorted[i - 1].dueDate;
    const progress = m.status === "completed" ? 100 : m.status === "in_progress" ? 50 : 0;
    return { title: m.title, start, dueDate: m.dueDate, status: m.status, progress };
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--ink2)" }}>
        Approximate timeline — bar starts are derived from the previous milestone’s due date; progress is estimated from status.
      </p>
      {/* Visual chart, exposed as an image with a descriptive label (WCAG 1.1.1). */}
      <div role="img" aria-label={ariaLabel}>
        <GanttChart tasks={tasks} startDate={projectStart} endDate={projectEnd ?? undefined} />
      </div>

      {/* Text alternative: a real, keyboard-navigable data table conveying the same
          information for screen-reader and keyboard-only users (WCAG 1.1.1 / 1.3.1 / 2.1.1). */}
      <div style={{ marginTop: 12 }}>
        <p className="sr-only" id="gantt-table-caption">Milestone timeline — text equivalent of the Gantt chart above</p>
        <DataTable<MilestoneRow>
          columns={[
            { key: "title", label: "Milestone" },
            { key: "start", label: "Start", render: (r) => formatIndianDate(r.start as string) },
            { key: "dueDate", label: "Due", render: (r) => formatIndianDate(r.dueDate as string) },
            { key: "status", label: "Status", render: (r) => STATUS_LABEL[r.status as string] ?? (r.status as string) },
            { key: "progress", label: "Progress", align: "right", render: (r) => <>{r.progress as number}%</> },
          ]}
          rows={tableRows}
        />
      </div>
    </div>
  );
}

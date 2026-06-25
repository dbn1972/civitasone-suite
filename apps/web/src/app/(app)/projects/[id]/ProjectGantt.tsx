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

  const tasks: GanttTask[] = milestones.map((m, i) => {
    const start = i === 0 ? projectStart : milestones[i - 1].dueDate;
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
    `Milestone timeline Gantt chart covering ${formatIndianDate(projectStart)}` +
    `${projectEnd ? ` to ${formatIndianDate(projectEnd)}` : ""}, ` +
    `${milestones.length} milestone${milestones.length === 1 ? "" : "s"}. ` +
    `An equivalent data table follows.`;

  const tableRows: MilestoneRow[] = milestones.map((m, i) => {
    const start = i === 0 ? projectStart : milestones[i - 1].dueDate;
    const progress = m.status === "completed" ? 100 : m.status === "in_progress" ? 50 : 0;
    return { title: m.title, start, dueDate: m.dueDate, status: m.status, progress };
  });

  return (
    <div>
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

"use client";

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

  return (
    <div>
      {/* Visual chart, exposed as an image with a descriptive label (WCAG 1.1.1). */}
      <div role="img" aria-label={ariaLabel}>
        <GanttChart tasks={tasks} startDate={projectStart} endDate={projectEnd ?? undefined} />
      </div>

      {/* Text alternative: a real, keyboard-navigable data table conveying the same
          information for screen-reader and keyboard-only users (WCAG 1.1.1 / 1.3.1 / 2.1.1). */}
      <table className="tbl" style={{ marginTop: 12 }}>
        <caption className="sr-only">Milestone timeline — text equivalent of the Gantt chart above</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left" }}>Milestone</th>
            <th scope="col" style={{ textAlign: "left" }}>Start</th>
            <th scope="col" style={{ textAlign: "left" }}>Due</th>
            <th scope="col" style={{ textAlign: "left" }}>Status</th>
            <th scope="col" className="num" style={{ textAlign: "right" }}>Progress</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((m, i) => {
            const start = i === 0 ? projectStart : milestones[i - 1].dueDate;
            const progress = m.status === "completed" ? 100 : m.status === "in_progress" ? 50 : 0;
            return (
              <tr key={`gantt-row-${i}`}>
                <td>{m.title}</td>
                <td>{formatIndianDate(start)}</td>
                <td>{formatIndianDate(m.dueDate)}</td>
                <td>{STATUS_LABEL[m.status] ?? m.status}</td>
                <td className="num">{progress}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

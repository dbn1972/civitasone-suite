"use client";

import { GanttChart, type GanttTask } from "../../../_components/GanttChart";

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

  return (
    <GanttChart
      tasks={tasks}
      startDate={projectStart}
      endDate={projectEnd ?? undefined}
    />
  );
}

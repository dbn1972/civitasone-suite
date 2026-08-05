import type { NotificationExperiment } from "@civitasone/types";

export function needsApproval(status: string): boolean {
  return status === "pending_approval";
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending_approval":
      return "Awaiting winner approval";
    case "running":
      return "Running";
    case "concluded":
      return "Concluded";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

export function rankExperiments(rows: NotificationExperiment[]): NotificationExperiment[] {
  const order: Record<string, number> = { pending_approval: 0, running: 1, draft: 2, concluded: 3 };
  return [...rows].sort((a, b) => {
    const ao = order[a.status] ?? 9;
    const bo = order[b.status] ?? 9;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

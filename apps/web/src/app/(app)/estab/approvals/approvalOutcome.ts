/**
 * Where an approval moved a noting, read from the workflow's own record of the instance
 * (GAP-ESTAB-APPROVALS-05). `GET /v1/workflow/tasks?instanceId=` lists every task of the
 * instance whatever its role, so after the approver's task shows completed:
 *  - another task still pending  -> the noting was forwarded to that role;
 *  - no other task pending       -> that was the last approval step.
 * While the task has not completed yet the approval is still being applied: null.
 * Nothing here looks at a role or task name, so renaming a role cannot change the result.
 */
export type InstanceTask = { id: string; status: string; roleRef?: string | null };

export type ApprovalOutcome =
  | { kind: "final" }
  | { kind: "forwarded"; roles: string[] };

export function outcomeFromInstanceTasks(tasks: InstanceTask[], completedTaskId: string): ApprovalOutcome | null {
  const own = tasks.find((t) => t.id === completedTaskId);
  if (!own || own.status !== "completed") return null;
  const open = tasks.filter((t) => t.id !== completedTaskId && t.status === "pending");
  if (open.length === 0) return { kind: "final" };
  const roles = [...new Set(open.map((t) => t.roleRef).filter((r): r is string => typeof r === "string" && r !== ""))];
  return { kind: "forwarded", roles };
}

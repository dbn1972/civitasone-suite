/**
 * W4: the maker's "correct and resubmit" task, raised by a Return from a node with no prior node.
 * It is recognised by MORE than its node key (a workflow admin cannot mint one by naming a node
 * "rework:x"): it must carry no role, be assigned to the instance initiator, and the prefix is
 * reserved at definition time (definitions/graph.ts, designer/domain.ts, insertGraphTx).
 */
export const REWORK_PREFIX = "rework:";
/** `rework:` + origin node key must fit tasks.node_key (varchar 64). */
export const MAX_REWORKABLE_NODE_KEY = 64 - REWORK_PREFIX.length;

export function isReservedNodeKey(nodeKey: string): boolean {
  return nodeKey.startsWith(REWORK_PREFIX);
}

export function isReworkTask(
  task: { nodeKey?: string | null; roleRef?: string | null; assigneeId?: string | null } | null | undefined,
  instance: { createdBy?: string | null } | null | undefined,
): boolean {
  return !!task && !!instance
    && typeof task.nodeKey === "string" && task.nodeKey.startsWith(REWORK_PREFIX)
    && !task.roleRef
    && !!task.assigneeId && task.assigneeId === instance.createdBy;
}

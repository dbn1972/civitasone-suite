/**
 * CAP-038 — comments / notes on any entity (pure domain).
 *
 * Comments attach to an (entityType, entityId) pair, may be threaded (a comment
 * can reply to another), and carry a visibility of `internal` (staff only) or
 * `external` (visible to the citizen/counterparty). This module holds the
 * visibility filter and thread-assembly logic; persistence is the caller's.
 */

export type Visibility = "internal" | "external";

export interface CommentNode<T extends { id: string; parentCommentId: string | null; visibility: string }> {
  comment: T;
  replies: CommentNode<T>[];
}

/**
 * Filter a comment list for a viewer. An external viewer may only see
 * `external` comments; internal viewers see everything.
 */
export function visibleTo<T extends { visibility: string }>(comments: T[], viewer: "internal" | "external"): T[] {
  if (viewer === "internal") return comments;
  return comments.filter((c) => c.visibility === "external");
}

/**
 * Assemble a flat, chronologically-ordered comment list into threads. Replies
 * whose parent is absent (e.g. filtered out by visibility, or deleted) are
 * promoted to top level so nothing is silently dropped.
 */
export function buildThreads<T extends { id: string; parentCommentId: string | null; visibility: string }>(comments: T[]): CommentNode<T>[] {
  const byId = new Map<string, CommentNode<T>>();
  for (const c of comments) byId.set(c.id, { comment: c, replies: [] });
  const roots: CommentNode<T>[] = [];
  for (const c of comments) {
    const node = byId.get(c.id)!;
    const parent = c.parentCommentId ? byId.get(c.parentCommentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

/** A non-empty body is required. */
export function validateBody(body: string | null | undefined): { allowed: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!body || body.trim().length === 0) errors.push("BODY_REQUIRED");
  return { allowed: errors.length === 0, errors };
}

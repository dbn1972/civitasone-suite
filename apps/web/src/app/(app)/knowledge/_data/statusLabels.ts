/**
 * Shared knowledge document status helpers — single source of truth for
 * status labels and pill variants across list, repository, search and detail pages.
 *
 * GAP-KNOWLEDGE-REPOSITORY-04 / GAP-KNOWLEDGE-POLICIES-06
 */

/** Sentence-case label for knowledge document statuses. */
export function knowledgeDocStatusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Published";
    case "under_review":
      return "Under review";
    case "draft":
      return "Draft";
    case "archived":
      return "Archived";
    default:
      // Title-case fallback: "some_thing" → "Some thing"
      return status
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
  }
}

/** StatusPill variant for knowledge document statuses. */
export function knowledgeDocStatusPill(status: string): string {
  switch (status) {
    case "approved":
      return "approved";
    case "under_review":
      return "pending";
    case "draft":
      return "draft";
    case "archived":
      return "archived";
    default:
      return "mut";
  }
}

/**
 * Sentence-case label for governed policy statuses
 * (policies use a superset: draft, under_review, approved, published,
 * superseded, withdrawn).
 */
export function policyStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "under_review":
      return "Under review";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "superseded":
      return "Superseded";
    case "withdrawn":
      return "Withdrawn";
    default:
      return status
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
  }
}

/** StatusPill variant for governed policy statuses. */
export function policyStatusPill(status: string): string {
  switch (status) {
    case "draft":
      return "draft";
    case "under_review":
      return "pending";
    case "approved":
      return "approved";
    case "published":
      return "active";
    case "superseded":
      return "archived";
    case "withdrawn":
      return "rejected";
    default:
      return "mut";
  }
}

/** Sentence-case labels for records statuses. */
export function recordStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "disposed":
      return "Disposed";
    case "transferred":
      return "Transferred";
    case "archived":
      return "Archived";
    default:
      return status
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
  }
}

/** StatusPill variant for records statuses. */
export function recordStatusPill(status: string): string {
  switch (status) {
    case "active":
      return "active";
    case "inactive":
      return "pending";
    case "disposed":
      return "archived";
    case "transferred":
      return "info";
    case "archived":
      return "archived";
    default:
      return "mut";
  }
}

/**
 * Normalise a free-text document category to a canonical segment key.
 * Matches on stems so "Circular" / "Circulars" both map to "Circulars".
 *
 * GAP-KNOWLEDGE-REPOSITORY-07
 */
export function categorySegment(rawCategory: string): "Circulars" | "Policies" | "Notifications" | "Other" {
  const lc = rawCategory.toLowerCase();
  if (lc.includes("circular")) return "Circulars";
  if (lc.includes("polic")) return "Policies";
  if (lc.includes("notif")) return "Notifications";
  return "Other";
}

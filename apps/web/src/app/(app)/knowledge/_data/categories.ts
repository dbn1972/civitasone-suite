/**
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-03: canonical document category list shared between
 * the create form, repository segment filters and dashboard computations. Prevents
 * free-text typos that silently fall out of filters.
 *
 * ⚠ Decision: the backend currently accepts any category string (validators.ts
 * only constrains length 1-64). This list is enforced UI-side for now and should
 * be promoted to a server-side enum once the knowledge-service categories module
 * is used. Unknown existing categories will appear under "Other" in the
 * repository segment filter.
 */
export const KNOWLEDGE_CATEGORIES = [
  "Circular",
  "Policy",
  "Notification",
  "SOP",
  "Guideline",
  "Retention Schedule",
  "Other",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const COMMANDS = {
  // Documents
  createDocument: "knowledge.document.create",

  // Categories
  categoryCreate: "knowledge.category.create",
  categoryUpdate: "knowledge.category.update",
  categoryDelete: "knowledge.category.delete",
  categoryReorder: "knowledge.category.reorder",

  // Retention
  retentionPolicyCreate: "knowledge.retention-policy.create",
  retentionPolicyUpdate: "knowledge.retention-policy.update",
  retentionPolicyApply: "knowledge.retention-policy.apply",

  // Search
  searchIndex: "knowledge.search.index",
  searchReindex: "knowledge.search.reindex",
  searchRemoveDocument: "knowledge.search.remove-document",

  // Versions
  versionCreate: "knowledge.version.create",
  versionRestore: "knowledge.version.restore",

  // Sharing
  shareCreate: "knowledge.share.create",
  shareRevoke: "knowledge.share.revoke",
} as const;

export const EVENTS = {
  // Documents
  documentCreated: "knowledge.document.created",

  // Categories
  categoryCreated: "knowledge.category.created",
  categoryUpdated: "knowledge.category.updated",
  categoryDeleted: "knowledge.category.deleted",
  categoryReordered: "knowledge.category.reordered",

  // Retention
  retentionPolicyCreated: "knowledge.retention-policy.created",
  retentionPolicyUpdated: "knowledge.retention-policy.updated",
  retentionPolicyApplied: "knowledge.retention-policy.applied",

  // Search
  searchIndexed: "knowledge.search.indexed",
  searchReindexed: "knowledge.search.reindexed",
  searchDocumentRemoved: "knowledge.search.document-removed",

  // Versions
  versionCreated: "knowledge.version.created",
  versionRestored: "knowledge.version.restored",

  // Sharing
  shareCreated: "knowledge.share.created",
  shareRevoked: "knowledge.share.revoked",

  // SVC-126 governed policy/SOP/circular lifecycle
  policyCreated: "knowledge.policy.created",
  policySubmitted: "knowledge.policy.submitted",
  policyApproved: "knowledge.policy.approved",
  policyPublished: "knowledge.policy.published",
  policySuperseded: "knowledge.policy.superseded",
  policyWithdrawn: "knowledge.policy.withdrawn",
  policyAcknowledged: "knowledge.policy.acknowledged",

  // SVC-127 virtual assistant & guided support
  assistantAnswered: "knowledge.assistant.answered",
  assistantEscalated: "knowledge.assistant.escalated",
} as const;

export const SERVICE = "knowledge";
export const RESOURCE = "document";

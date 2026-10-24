/** Topic names owned by the identity-providers module (kept out of the shared topics.ts to avoid merge churn). */
export const IDP_COMMANDS = {
  create: "admin.identity_provider.create",
  update: "admin.identity_provider.update",
  remove: "admin.identity_provider.delete",
} as const;

export const IDP_EVENTS = {
  created: "admin.identity_provider.created",
  updated: "admin.identity_provider.updated",
  deleted: "admin.identity_provider.deleted",
} as const;

export const COMMANDS = {
  createRole:       "policy.role.create",
  updateRole:       "policy.role.update",
  addPermission:    "policy.permission.add",
  createBinding:    "policy.binding.create",
  revokeBinding:    "policy.binding.revoke",
  requestBreakglass:"policy.breakglass.request",
  createAbacRule:   "policy.abac.rule.create",
  updateAbacRule:   "policy.abac.rule.update",
  deleteAbacRule:   "policy.abac.rule.delete",
  // ── role features ──────────────────────────────────────────────────────
  roleFeatureGrant:  "policy.role_feature.grant",
  roleFeatureRevoke: "policy.role_feature.revoke",
} as const;

export const EVENTS = {
  roleCreated:        "policy.role.created",
  roleUpdated:        "policy.role.updated",
  permissionAdded:    "policy.permission.added",
  bindingCreated:     "policy.binding.created",
  bindingRevoked:     "policy.binding.revoked",
  breakglassRequested:"policy.breakglass.requested",
  abacRuleCreated:    "policy.abac.rule.created",
  abacRuleUpdated:    "policy.abac.rule.updated",
  abacRuleDeleted:    "policy.abac.rule.deleted",
  // ── role features ──────────────────────────────────────────────────────
  roleFeatureGranted: "policy.role_feature.granted",
  roleFeatureRevoked: "policy.role_feature.revoked",
} as const;

export const SERVICE = "policy";
export const RESOURCE = {
  role:       "role",
  binding:    "binding",
  breakglass: "breakglass",
  abacRule:   "abac_rule",
};

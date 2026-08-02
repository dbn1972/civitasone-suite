export const COMMANDS = {
  createUser:      "identity.user.create",
  updateUser:      "identity.user.update",
  deactivateUser:  "identity.user.deactivate",
  createSession:   "identity.session.create",
  revokeSession:   "identity.session.revoke",
  revokeAllSessions: "identity.session.revoke_all",
  resetPassword:   "identity.user.reset_password",
  enableMfa:       "identity.mfa.enable",
  setupMfa:        "identity.mfa.setup",
  mfaVerifyFail:   "identity.mfa.verify_fail",
  mfaVerifySuccess:"identity.mfa.verify_success",
  scimUserCreate:  "identity.scim.user.create",
  scimUserReplace: "identity.scim.user.replace",
  scimUserPatch:   "identity.scim.user.patch",
  scimUserDelete:  "identity.scim.user.delete",
  // RBAC (wave 2)
  rbacCreateRole:        "identity.rbac.role.create",
  rbacCreatePermission:  "identity.rbac.permission.create",
  rbacGrantPermission:   "identity.rbac.permission.grant",
  rbacRevokePermission:  "identity.rbac.permission.revoke",
  rbacAssignRole:        "identity.rbac.role.assign",
  rbacRevokeRole:        "identity.rbac.role.revoke",
} as const;

export const EVENTS = {
  userCreated:     "identity.user.created",
  userUpdated:     "identity.user.updated",
  userDeactivated: "identity.user.deactivated",
  sessionCreated:  "identity.session.created",
  sessionRevoked:  "identity.session.revoked",
  sessionRevokedAll: "identity.session.revoked_all",
  passwordResetRequested: "identity.user.password_reset_requested",
  mfaEnabled:      "identity.mfa.enabled",
  // RBAC (wave 2)
  rbacRoleCreated:        "identity.rbac.role.created",
  rbacPermissionCreated:  "identity.rbac.permission.created",
  rbacPermissionGranted:  "identity.rbac.permission.granted",
  rbacPermissionRevoked:  "identity.rbac.permission.revoked",
  rbacRoleAssigned:       "identity.rbac.role.assigned",
  rbacRoleRevoked:        "identity.rbac.role.revoked",
} as const;

export const SERVICE = "identity";
export const RESOURCE = {
  user:    "user",
  session: "session",
  mfa:     "mfa",
  role:    "rbac_role",
};

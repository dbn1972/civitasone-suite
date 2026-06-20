export const COMMANDS = {
  createUser:      "identity.user.create",
  updateUser:      "identity.user.update",
  deactivateUser:  "identity.user.deactivate",
  createSession:   "identity.session.create",
  revokeSession:   "identity.session.revoke",
  enableMfa:       "identity.mfa.enable",
} as const;

export const EVENTS = {
  userCreated:     "identity.user.created",
  userUpdated:     "identity.user.updated",
  userDeactivated: "identity.user.deactivated",
  sessionCreated:  "identity.session.created",
  sessionRevoked:  "identity.session.revoked",
  mfaEnabled:      "identity.mfa.enabled",
} as const;

export const SERVICE = "identity";
export const RESOURCE = {
  user:    "user",
  session: "session",
  mfa:     "mfa",
};

export type SessionStatus = "active" | "revoked" | "expired";

export type SessionView = {
  id: string;
  tenantId: string;
  userId: string;
  ip: string;
  device: string | null;
  mfaMethod: string | null;
  trusted: boolean;
  status: SessionStatus;
  startedAt: string;
  expiresAt: string;
  version: number;
};

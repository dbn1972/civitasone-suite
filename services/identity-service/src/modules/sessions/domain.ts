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
  userEmail: string;
  userName: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  startedAt: string;
  expiresAt: string;
  version: number;
};

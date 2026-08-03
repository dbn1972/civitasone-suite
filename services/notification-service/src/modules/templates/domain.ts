export type TemplateView = {
  id: string;
  tenantId: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  status: string;
  version: number;
  supersededBy: string | null;
  // Approval workflow fields (optional — null when not in approval flow)
  contentType?: string | null;
  submittedBy?: string | null;
  submittedAt?: Date | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  rejectionReason?: string | null;
};

export type PrefView = {
  id: string;
  tenantId: string;
  userId: string;
  eventType: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
  /** Tri-state: `null` = no choice recorded, `false` = opt-out, `true` = opt-in. */
  sms: boolean | null;
  whatsapp: boolean | null;
  version: number;
};

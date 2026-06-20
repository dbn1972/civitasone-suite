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
};

export type PrefView = {
  id: string;
  tenantId: string;
  userId: string;
  eventType: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
  version: number;
};

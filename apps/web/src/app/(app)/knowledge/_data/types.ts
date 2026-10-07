/** knowledge feature (SVC-126 / SVC-127) — web view models. */

export type PolicySummary = {
  id: string;
  docType: string;
  referenceNo: string | null;
  title: string;
  status: string;
  authorId: string;
  approverId: string | null;
  effectiveDate: string | null;
  reviewDueDate: string | null;
  version: number;
  updatedAt: string;
};

export type PolicyDetail = PolicySummary & {
  body: string;
  reviewerId: string | null;
  supersedesId: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type AckSummary = {
  acknowledgedCount: number;
  employeeIds: string[];
};

export type FaqSummary = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
  status: string;
  updatedAt: string;
};

export type GuidedFlowStep = { order: number; title: string; instruction: string };

export type GuidedFlowSummary = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  steps: GuidedFlowStep[];
  status: string;
};

// GAP-KNOWLEDGE-LIST-01: document detail type for the article endpoint.
export type DocumentDetail = {
  id: string;
  tenantId: string;
  title: string;
  category: string | null;
  status: string;
  tags: string[];
  accessLevel: string;
  fileType: string | null;
  fileSize: number | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type DeflectionMetrics = {
  total: number;
  answered: number;
  escalated: number;
  deflected: number;
  deflectionRate: number;
  escalationRate: number;
};

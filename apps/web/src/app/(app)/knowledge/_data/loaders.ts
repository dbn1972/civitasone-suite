/**
 * knowledge feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts): every loader
 * returns LoaderResult<T> = { data, source } and never throws. Gateway rewrites
 * the "/api/v1/knowledge" prefix to the knowledge-service base "/v1/knowledge".
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type {
  PolicySummary,
  PolicyDetail,
  AckSummary,
  FaqSummary,
  GuidedFlowSummary,
  GuidedFlowStep,
  DeflectionMetrics,
} from "./types";

function asArray(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}
function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function toPolicySummary(r: Record<string, unknown>): PolicySummary {
  return {
    id: str(r.id),
    docType: str(r.docType, "sop"),
    referenceNo: strOrNull(r.referenceNo),
    title: str(r.title),
    status: str(r.status, "draft"),
    authorId: str(r.authorId),
    approverId: strOrNull(r.approverId),
    effectiveDate: strOrNull(r.effectiveDate),
    reviewDueDate: strOrNull(r.reviewDueDate),
    version: num(r.version, 1),
    updatedAt: str(r.updatedAt),
  };
}

export function getKnowledgePolicies(): Promise<LoaderResult<PolicySummary[]>> {
  return fetchJson<unknown, PolicySummary[]>("/api/v1/knowledge/policies", [], {
    revalidateSeconds: 20,
    telemetryKey: "knowledge.policies",
    mapResponse: (payload) => asArray(payload).map(toPolicySummary),
  });
}

export function getReviewDuePolicies(): Promise<LoaderResult<PolicySummary[]>> {
  return fetchJson<unknown, PolicySummary[]>("/api/v1/knowledge/policies/review-due", [], {
    revalidateSeconds: 60,
    telemetryKey: "knowledge.policies.review-due",
    mapResponse: (payload) => asArray(payload).map(toPolicySummary),
  });
}

export function getKnowledgePolicy(id: string): Promise<LoaderResult<PolicyDetail | null>> {
  return fetchJson<unknown, PolicyDetail | null>(`/api/v1/knowledge/policies/${id}`, null, {
    revalidateSeconds: 10,
    telemetryKey: "knowledge.policy.detail",
    mapResponse: (payload) => {
      const r = asObj(payload);
      if (!r) return null;
      return {
        ...toPolicySummary(r),
        body: str(r.body),
        reviewerId: strOrNull(r.reviewerId),
        supersedesId: strOrNull(r.supersedesId),
        publishedAt: strOrNull(r.publishedAt),
        createdAt: str(r.createdAt),
      };
    },
  });
}

export function getPolicyAcknowledgements(id: string): Promise<LoaderResult<AckSummary>> {
  return fetchJson<unknown, AckSummary>(`/api/v1/knowledge/policies/${id}/acknowledgements`, { acknowledgedCount: 0, employeeIds: [] }, {
    revalidateSeconds: 10,
    telemetryKey: "knowledge.policy.acks",
    mapResponse: (payload) => {
      const r = asObj(payload);
      const ids = r && Array.isArray(r.employeeIds) ? (r.employeeIds as unknown[]).map((x) => str(x)) : [];
      return { acknowledgedCount: num(r?.acknowledgedCount, ids.length), employeeIds: ids };
    },
  });
}

export function getKnowledgeFaqs(): Promise<LoaderResult<FaqSummary[]>> {
  return fetchJson<unknown, FaqSummary[]>("/api/v1/knowledge/faqs", [], {
    revalidateSeconds: 30,
    telemetryKey: "knowledge.faqs",
    mapResponse: (payload) => asArray(payload).map((r) => ({
      id: str(r.id),
      question: str(r.question),
      answer: str(r.answer),
      category: strOrNull(r.category),
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map((t) => str(t)) : [],
      status: str(r.status, "published"),
      updatedAt: str(r.updatedAt),
    })),
  });
}

export function getKnowledgeGuidedFlows(): Promise<LoaderResult<GuidedFlowSummary[]>> {
  return fetchJson<unknown, GuidedFlowSummary[]>("/api/v1/knowledge/guided-flows", [], {
    revalidateSeconds: 30,
    telemetryKey: "knowledge.guided-flows",
    mapResponse: (payload) => asArray(payload).map((r) => ({
      id: str(r.id),
      title: str(r.title),
      description: strOrNull(r.description),
      category: strOrNull(r.category),
      steps: Array.isArray(r.steps)
        ? (r.steps as Record<string, unknown>[]).map((s): GuidedFlowStep => ({
            order: num(s.order),
            title: str(s.title),
            instruction: str(s.instruction),
          }))
        : [],
      status: str(r.status, "published"),
    })),
  });
}

export function getAssistantMetrics(): Promise<LoaderResult<DeflectionMetrics>> {
  const empty: DeflectionMetrics = { total: 0, answered: 0, escalated: 0, deflected: 0, deflectionRate: 0, escalationRate: 0 };
  return fetchJson<unknown, DeflectionMetrics>("/api/v1/knowledge/assistant/metrics", empty, {
    revalidateSeconds: 30,
    telemetryKey: "knowledge.assistant.metrics",
    mapResponse: (payload) => {
      const r = asObj(payload);
      if (!r) return empty;
      return {
        total: num(r.total),
        answered: num(r.answered),
        escalated: num(r.escalated),
        deflected: num(r.deflected),
        deflectionRate: num(r.deflectionRate),
        escalationRate: num(r.escalationRate),
      };
    },
  });
}

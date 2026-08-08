"use client";

import type { TestRunStep } from "@/app/_components/ds/designer";

export interface SandboxTestRunDto {
  id: string;
  status: "pass" | "fail" | "running" | "none";
  passed?: boolean;
  steps?: TestRunStep[];
  durationMs?: number;
  createdAt?: string;
}

export interface SandboxRunHistoryRow {
  id: string;
  status: string;
  durationMs: number | null;
  createdAt: string;
}

function mapSteps(steps: unknown, definitionId: string): TestRunStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    const row = s as Record<string, unknown>;
    const status = row.status === "pass" || row.status === "fail" || row.status === "skip"
      ? (row.status === "skip" ? "pass" : row.status)
      : "pending";
    return {
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      status: status as TestRunStep["status"],
      error: typeof row.error === "string" ? row.error : undefined,
      blockLink: typeof row.blockLink === "string"
        ? row.blockLink.replace("__ID__", definitionId)
        : undefined,
      artifacts: typeof row.artifacts === "object" && row.artifacts !== null
        ? row.artifacts as Record<string, unknown>
        : undefined,
    };
  });
}

export async function runSandboxTest(definitionId: string): Promise<SandboxTestRunDto> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${definitionId}/sandbox-test/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Sandbox test failed (${res.status})`);
  }
  const body = await res.json() as Record<string, unknown>;
  return {
    id: String(body.id),
    status: body.status === "pass" ? "pass" : "fail",
    passed: Boolean(body.passed),
    durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
    steps: mapSteps(body.steps, definitionId),
  };
}

export async function fetchSandboxTestHistory(definitionId: string): Promise<SandboxRunHistoryRow[]> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${definitionId}/sandbox-test/runs`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = await res.json() as { data?: unknown[] };
  return (body.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      status: String(row.status),
      durationMs: typeof row.durationMs === "number" ? row.durationMs : null,
      createdAt: String(row.createdAt ?? ""),
    };
  });
}

export async function fetchLatestSandboxTest(definitionId: string): Promise<SandboxTestRunDto> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${definitionId}/sandbox-test/latest`, {
    cache: "no-store",
  });
  if (!res.ok) return { id: "", status: "none" };
  const body = await res.json() as Record<string, unknown>;
  if (body.status === "none") return { id: "", status: "none" };
  return {
    id: String(body.id),
    status: body.status === "pass" ? "pass" : "fail",
    durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
    createdAt: String(body.createdAt ?? ""),
  };
}

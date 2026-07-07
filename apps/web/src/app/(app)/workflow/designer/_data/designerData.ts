import { cookies } from "next/headers";
import { COOKIE } from "@/lib/auth/config";

export type DesignerSource = "api" | "error";
export interface DesignerResult<T> {
  data: T;
  source: DesignerSource;
  status?: number;
}

export interface DesignerDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  elementCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesignerNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  properties?: Record<string, unknown>;
}

export interface DesignerEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}

export interface DesignerDefinitionDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  elements: DesignerNode[];
  edges: DesignerEdge[];
}

export interface ValidationViolation {
  elementId: string;
  type: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: ValidationViolation[];
}

function gatewayBaseUrl(): string | null {
  const base =
    process.env.CIVITASONE_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    null;
  return base && base.length > 0 ? base.replace(/\/$/, "") : null;
}

function authHeader(): Record<string, string> {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function getDesignerDefinitions(): Promise<DesignerResult<DesignerDefinitionSummary[]>> {
  const base = gatewayBaseUrl();
  if (!base) return { data: [], source: "error" };
  const auth = authHeader();
  if (!auth.authorization) return { data: [], source: "error", status: 401 };

  try {
    const res = await fetch(`${base}/api/v1/workflow/designer/definitions?pageSize=100`, {
      headers: { "content-type": "application/json", ...auth },
      next: { revalidate: 30 },
    });
    if (!res.ok) return { data: [], source: "error", status: res.status };
    const raw = await res.json();
    const data = Array.isArray(raw?.data) ? raw.data : [];
    return { data, source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function getDesignerDefinitionById(
  id: string,
): Promise<DesignerResult<DesignerDefinitionDetail | null>> {
  const base = gatewayBaseUrl();
  if (!base) return { data: null, source: "error" };
  const auth = authHeader();
  if (!auth.authorization) return { data: null, source: "error", status: 401 };

  try {
    const res = await fetch(`${base}/api/v1/workflow/designer/definitions/${id}`, {
      headers: { "content-type": "application/json", ...auth },
      next: { revalidate: 10 },
    });
    if (!res.ok) return { data: null, source: "error", status: res.status };
    const raw = await res.json();
    return { data: raw?.data ?? null, source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

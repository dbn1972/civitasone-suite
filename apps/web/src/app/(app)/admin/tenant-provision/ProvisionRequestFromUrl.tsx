"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProvisionRequestCard, parseRequestId, type ProvisionRequestResult } from "./ProvisionRequestCard";

async function loadRequest(id: string): Promise<ProvisionRequestResult> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/onboarding/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return { data: null, source: "error", status: res.status };
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const d = body.data;
    if (!d || typeof d !== "object") return { data: null, source: "api" };
    return {
      source: "api",
      data: {
        id: String(d.id ?? ""), org: String(d.org ?? ""), contact: String(d.contact ?? ""),
        requested: String(d.requested ?? ""), assigned: String(d.assigned ?? ""), stage: String(d.stage ?? ""),
      },
    };
  } catch {
    return { data: null, source: "error" };
  }
}

function Inner() {
  const requestId = parseRequestId(useSearchParams()?.get("requestId") ?? undefined);
  const [result, setResult] = useState<ProvisionRequestResult | null>(null);
  useEffect(() => {
    if (!requestId) { setResult(null); return; }
    let cancelled = false;
    setResult(null);
    void loadRequest(requestId).then((r) => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, [requestId]);
  if (!requestId) return null;
  if (!result) return <p role="status" style={{ fontSize: 13, color: "var(--mut)" }}>Loading the onboarding request…</p>;
  return <ProvisionRequestCard result={result} />;
}

/**
 * GAP-ADMIN-ONBOARDING-07: when the page is opened from a queue row (`?requestId=`), show which
 * request this visit is for. Client-side so the page stays a plain argument-less server component.
 * The id is validated as a UUID before it is sent; the API still enforces tenant scope and role.
 */
export function ProvisionRequestFromUrl() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

"use client";

import { toHumanError } from "@/lib/messages";

/**
 * Plain-language failure message for a failed submit/publish/reject call.
 * This is a plain async data client, not a component, so it can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on — never the backend's own message/error text
 * or the raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
 * UX-003/UX-016.
 */
function serviceDefinitionSaveError(): string {
  const human = toHumanError("save", { area: "service definition" });
  return `${human.what} ${human.next}`;
}

async function parseAccepted(res: Response): Promise<{ id: string }> {
  if (!(res.ok || res.status === 202)) {
    throw new Error(serviceDefinitionSaveError());
  }
  return res.json() as Promise<{ id: string }>;
}

export async function submitForApproval(definitionId: string): Promise<void> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${definitionId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await parseAccepted(res);
}

export async function publishDefinition(definitionId: string): Promise<void> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${definitionId}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await parseAccepted(res);
}

export async function rejectDefinition(definitionId: string, comment: string): Promise<void> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${definitionId}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  await parseAccepted(res);
}

export async function fetchPublishedByKey(serviceKey: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `/api/proxy/v1/citizen/catalogue/published/lookup?serviceKey=${encodeURIComponent(serviceKey)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<Record<string, unknown>>;
}

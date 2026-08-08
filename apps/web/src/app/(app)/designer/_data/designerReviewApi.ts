"use client";

async function parseAccepted(res: Response): Promise<{ id: string }> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
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

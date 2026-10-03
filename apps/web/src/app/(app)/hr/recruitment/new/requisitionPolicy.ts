"use client";

import { useCallback, useEffect, useState } from "react";

// GAP-RECRUITMENT-NEW-06: whether this tenant's edition requires every vacancy to come from an approved requisition.

/**
 * GET /v1/hrms/recruitment-policy. Any failure answers false on purpose: the form stays usable and the
 * server -- which enforces the rule on POST /job-openings -- is the authority (it answers 409 REQUISITION_REQUIRED).
 */
export async function fetchRequisitionRequired(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/proxy/v1/hrms/recruitment-policy", { signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { requisitionRequired?: unknown };
    return body.requisitionRequired === true;
  } catch {
    return false;
  }
}

/** True for the server's "this edition needs a requisition" refusal (409 + code REQUISITION_REQUIRED). */
export async function isRequisitionRequiredResponse(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return body.code === "REQUISITION_REQUIRED";
  } catch {
    return false;
  }
}

export function useRequisitionPolicy(): { requisitionRequired: boolean; markRequired: () => void } {
  const [requisitionRequired, setRequired] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchRequisitionRequired(controller.signal).then((v) => { if (!controller.signal.aborted) setRequired(v); });
    return () => controller.abort();
  }, []);
  const markRequired = useCallback(() => setRequired(true), []);
  return { requisitionRequired, markRequired };
}

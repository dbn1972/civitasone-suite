"use client";

import { useEffect, useState } from "react";

export type SessionIdentity = {
  /** false until /api/auth/session has answered (or failed). */
  loaded: boolean;
  userId: string | null;
  roles: readonly string[];
};

const EMPTY: SessionIdentity = { loaded: false, userId: null, roles: [] };
/** `failed` marks a transient failure (thrown fetch, non-ok response, unparsable body): shown as loaded-but-empty,
 *  but never cached, so the next mount retries (CLOS3-S3-07). */
type FetchedIdentity = SessionIdentity & { failed?: boolean };
let inflight: Promise<FetchedIdentity> | null = null;

async function fetchIdentity(): Promise<FetchedIdentity> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return { loaded: true, userId: null, roles: [], failed: true };
    const j = (await res.json()) as { authenticated?: boolean; userId?: string; roles?: unknown };
    if (!j.authenticated) return { loaded: true, userId: null, roles: [] };
    const roles = Array.isArray(j.roles) ? j.roles.filter((r): r is string => typeof r === "string") : [];
    return { loaded: true, userId: j.userId ? j.userId : null, roles };
  } catch {
    return { loaded: true, userId: null, roles: [], failed: true };
  }
}

/** Test seam: forget the cached answer. */
export function resetSessionIdentityCache(): void {
  inflight = null;
}

/**
 * The signed-in user's id and roles, for DISPLAY decisions only (which action buttons to offer,
 * maker-checker "you created this" hints). The services re-check every role and maker-checker rule,
 * so a wrong answer here can never grant anything -- it can only show or hide a button.
 */
export function useSessionIdentity(): SessionIdentity {
  const [identity, setIdentity] = useState<SessionIdentity>(EMPTY);
  useEffect(() => {
    let live = true;
    const p = (inflight ??= fetchIdentity());
    void p.then((v) => {
      if (v.failed && inflight === p) inflight = null;
      if (live) setIdentity({ loaded: v.loaded, userId: v.userId, roles: v.roles });
    });
    return () => { live = false; };
  }, []);
  return identity;
}

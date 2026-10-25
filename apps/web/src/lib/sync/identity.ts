"use client";

import { useEffect, useState } from "react";
import type { StoreNamespace } from "./indexedDb";

/**
 * Resolves the current tenant+user so the local cache can be namespaced and
 * encrypted per account (01-T5). The session endpoint decodes the trusted
 * access-cookie JWT; we cache the result for the tab session.
 */
let cached: Promise<StoreNamespace | null> | null = null;

async function fetchNamespace(): Promise<{ ns: StoreNamespace | null; definite: boolean }> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!res.ok) return { ns: null, definite: false };
    const data = (await res.json()) as { authenticated?: boolean; tenantId?: string; userId?: string };
    if (!data.authenticated) return { ns: null, definite: true };
    return { ns: { tenantId: data.tenantId ?? "", userId: data.userId ?? "" }, definite: true };
  } catch {
    return { ns: null, definite: false };
  }
}

export function resolveNamespace(): Promise<StoreNamespace | null> {
  if (cached) return cached;
  // CLOS3-S3-06: only a definite answer (authenticated or not) stays memoised. A transient failure
  // (network error / non-OK) resolves null for THIS call but drops the memo, so the next call
  // retries instead of pinning the tab to the un-namespaced shared stores until logout.
  const p: Promise<StoreNamespace | null> = fetchNamespace().then((r) => {
    if (!r.definite && cached === p) cached = null;
    return r.ns;
  });
  cached = p;
  return p;
}

/** Clear the cached namespace (call on logout). */
export function clearNamespaceCache(): void {
  cached = null;
}

/** React hook: returns the sync namespace once resolved, or null while loading. */
export function useSyncNamespace(): StoreNamespace | null {
  const [ns, setNs] = useState<StoreNamespace | null>(null);
  useEffect(() => {
    let active = true;
    void resolveNamespace().then((value) => {
      if (active) setNs(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return ns;
}

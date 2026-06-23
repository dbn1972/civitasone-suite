"use client";

import { useEffect, useState } from "react";
import type { StoreNamespace } from "./indexedDb";

/**
 * Resolves the current tenant+user so the local cache can be namespaced and
 * encrypted per account (01-T5). The session endpoint decodes the trusted
 * access-cookie JWT; we cache the result for the tab session.
 */
let cached: Promise<StoreNamespace | null> | null = null;

export function resolveNamespace(): Promise<StoreNamespace | null> {
  if (cached) return cached;
  cached = (async () => {
    try {
      const res = await fetch("/api/auth/session", { credentials: "same-origin" });
      if (!res.ok) return null;
      const data = (await res.json()) as { authenticated?: boolean; tenantId?: string; userId?: string };
      if (!data.authenticated) return null;
      return { tenantId: data.tenantId ?? "", userId: data.userId ?? "" };
    } catch {
      return null;
    }
  })();
  return cached;
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

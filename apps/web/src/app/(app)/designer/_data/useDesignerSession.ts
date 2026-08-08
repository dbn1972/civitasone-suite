"use client";

import { useEffect, useState } from "react";

export interface DesignerSession {
  userId: string;
  tenantId: string;
}

export function useDesignerSession(): DesignerSession | null {
  const [session, setSession] = useState<DesignerSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json() as { authenticated?: boolean; userId?: string; tenantId?: string };
        if (!cancelled && data.authenticated) {
          setSession({ userId: data.userId ?? "", tenantId: data.tenantId ?? "" });
        }
      } catch {
        // session unavailable
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return session;
}

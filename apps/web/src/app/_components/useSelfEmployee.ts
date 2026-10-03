"use client";

import { useEffect, useRef, useState } from "react";
import type { EntityOption } from "@/app/_components/ds";

/**
 * The signed-in user's own employee record as an EntityPicker option (name + employee number), looked up
 * once, the first time `enabled` turns true. Used to default an "initiating officer" to the current user
 * (GAP-FINANCE-PAYMENTS-DETAIL-02). Best-effort: a user with no employee record (404), no HR access or a
 * failed lookup yields null and the picker simply starts empty.
 */
export function useSelfEmployee(enabled: boolean): EntityOption | null {
  const [self, setSelf] = useState<EntityOption | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/hrms/me/profile", { signal: controller.signal });
        if (!res.ok) return;
        const me = (await res.json()) as { id?: string; fullName?: string; name?: string; employeeNo?: string };
        const name = me.fullName ?? me.name;
        if (!me.id || !name) return;
        setSelf({ id: me.id, label: me.employeeNo ? `${name} (${me.employeeNo})` : name });
      } catch {
        // best-effort default only
      }
    })();
    return () => controller.abort();
  }, [enabled]);
  return self;
}

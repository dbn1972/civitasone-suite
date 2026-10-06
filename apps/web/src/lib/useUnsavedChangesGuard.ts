"use client";

import { useEffect } from "react";

/**
 * GAP-PLATFORM-ADMIN-ORG-CONFIG-03: warn before a browser tab close/reload
 * when there are unsaved changes. Extracted from SystemSettingsPage's inline
 * beforeunload handler so OrgConfigPage and SystemSettingsPage share one
 * implementation.
 *
 * NOTE: beforeunload only covers full-page unloads (tab close, reload,
 * external navigation). In-app next/link client navigation is NOT covered by
 * this browser event — a route-change guard would need the router's own
 * events and is out of scope here.
 */
export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Legacy browsers require returnValue to be set to trigger the prompt.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
